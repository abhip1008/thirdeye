import { useLocalSearchParams, useRouter } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Header } from '@/components/Header';
import { OverlayCanvas, OverlayState, defaultOverlay } from '@/components/OverlayCanvas';
import { Scrubber } from '@/components/Scrubber';
import { StatusLabel } from '@/components/StatusDot';
import { EmptyState, Muted, Screen } from '@/components/ui';
import { FALLBACK_FPS } from '@/config/appConfig';
import { insertReview, reviewForClip } from '@/db/queries';
import { log } from '@/lib/log';
import { resolveVideoSource } from '@/mock/sampleAsset';
import { audit } from '@/privacy/audit';
import { useClips } from '@/stores/clipStore';
import { useMatch } from '@/stores/matchStore';
import { colors } from '@/theme/colors';
import { TOUCH_MIN, radius, space } from '@/theme/spacing';
import { type } from '@/theme/typography';
import type { Decision } from '@/types/protocol';

const SPEEDS = [
  { rate: 1, label: 'Full speed' },
  { rate: 0.5, label: 'Half' },
  { rate: 0.25, label: 'Quarter' },
  { rate: 0.125, label: 'Eighth' },
] as const;

/**
 * The review player.
 *
 * Three controls on screen: step back, play, step forward. Everything else is
 * behind a single word that opens one panel at a time, because an umpire under
 * pressure should be looking at the ball rather than reading a toolbar.
 *
 * Frame stepping is why anyone opens this at all, and it is the one thing the
 * build plan warned could quietly not work. `expo-video` seeks exactly by
 * default - its seek tolerance is zero unless widened - so setting the position
 * to `t +/- 1/fps` lands on the requested frame rather than the nearest
 * keyframe. The bundled sample has a marker that advances a fixed distance every
 * frame, so this is checkable by eye rather than by hope.
 */
export default function ClipScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ seq: string }>();
  const match = useMatch((s) => s.match);
  const clips = useClips((s) => s.clips);

  const { cameraId, seq } = useMemo(() => parseRouteKey(params.seq), [params.seq]);
  const clip = useMemo(
    () => clips.find((c) => c.camera_id === cameraId && c.seq === seq),
    [clips, cameraId, seq]
  );

  const fps = clip?.fps || FALLBACK_FPS;
  const frameStep = 1 / fps;

  const source = useMemo(() => resolveVideoSource(clip?.localPath ?? null), [clip?.localPath]);
  const player = useVideoPlayer(source ?? null, (p) => {
    p.loop = false;
    p.muted = true;
    p.timeUpdateEventInterval = 0.05;
  });

  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [panel, setPanel] = useState<'none' | 'speed' | 'lines' | 'decision'>('none');
  const [overlay, setOverlay] = useState<OverlayState>(defaultOverlay);
  const [decision, setDecision] = useState<Decision | null>(null);
  const scrubbing = useRef(false);

  const duration = clip?.duration_s ?? player?.duration ?? 0;

  useEffect(() => {
    const id = setInterval(() => {
      if (!player || scrubbing.current) return;
      setPosition(player.currentTime ?? 0);
      setPlaying(player.playing ?? false);
    }, 60);
    return () => clearInterval(id);
  }, [player]);

  useEffect(() => {
    if (!match || !clip) return;
    void reviewForClip(match.id, clip.camera_id, clip.seq).then((r) => {
      if (r?.decision) setDecision(r.decision);
    });
  }, [match, clip]);

  const seekTo = useCallback(
    (secondsInto: number) => {
      if (!player) return;
      const clamped = Math.min(Math.max(0, secondsInto), Math.max(0, duration - frameStep));
      // Assignment is how expo-video seeks; the player is a handle on a native
      // object, not React state, and its default tolerance is zero - which is
      // what makes this land on the requested frame.
      // eslint-disable-next-line react-hooks/immutability
      player.currentTime = clamped;
      setPosition(clamped);
    },
    [player, duration, frameStep]
  );

  const step = useCallback(
    (frames: number) => {
      if (!player) return;
      player.pause();
      setPlaying(false);
      seekTo((player.currentTime ?? 0) + frames * frameStep);
    },
    [player, seekTo, frameStep]
  );

  const togglePlay = useCallback(() => {
    if (!player) return;
    if (player.playing) player.pause();
    else player.play();
    setPlaying(!player.playing);
  }, [player]);

  const changeSpeed = useCallback(
    (rate: number) => {
      setSpeed(rate);
      // Same as above: a native player handle, not a React value.
      // eslint-disable-next-line react-hooks/immutability
      if (player) player.playbackRate = rate;
      setPanel('none');
    },
    [player]
  );

  const recordDecision = useCallback(
    async (value: Decision) => {
      if (!match || !clip) return;
      setDecision(value);
      setPanel('none');
      await insertReview({
        matchId: match.id,
        cameraId: clip.camera_id,
        seq: clip.seq,
        calledAt: Date.now() / 1000,
        appealType: null,
        decision: value,
        notes: null,
      });
      await useClips.getState().markReviewed(clip.camera_id, clip.seq);
      // A reviewed clip is evidence of a decision, so it is kept rather than
      // rolled out of the ring on the next delivery.
      if (!clip.pinned) await useClips.getState().pin(clip.camera_id, clip.seq, 'review');
      await audit('review.recorded', match.id, {
        camera_id: clip.camera_id, seq: clip.seq, decision: value,
      });
      log.info('review', `ball ${clip.seq}: ${value}`);
    },
    [match, clip]
  );

  if (!clip) {
    return (
      <Screen>
        <Header title="Clip" />
        <EmptyState title="That clip is gone" body="It rolled past twelve balls and was deleted." />
      </Screen>
    );
  }

  const playable = clip.status === 'ready' && !!clip.localPath;
  const speedLabel = SPEEDS.find((s2) => s2.rate === speed)?.label ?? 'Full speed';
  const lineCount = Number(overlay.showStumpLine) + Number(overlay.showBailLine);
  const decisionLabel =
    decision === 'out' ? 'Out' : decision === 'not_out' ? 'Not out' : decision === 'inconclusive' ? 'Unclear' : 'Decide';

  return (
    <Screen>
      <Header
        title={`Ball ${clip.seq}`}
        action={{
          label: clip.pinned ? 'Kept' : 'Keep',
          onPress: () =>
            void (clip.pinned
              ? useClips.getState().unpin(clip.camera_id, clip.seq)
              : useClips.getState().pin(clip.camera_id, clip.seq, 'wicket')),
          tint: clip.pinned ? colors.ready : colors.accent,
        }}
        onBack={() => router.back()}
      />

      <View style={s.stage}>
        {playable ? (
          <Pressable style={StyleSheet.absoluteFill} onPress={togglePlay} accessibilityLabel="Play or pause">
            <VideoView style={StyleSheet.absoluteFill} player={player} nativeControls={false} contentFit="contain" />
          </Pressable>
        ) : (
          <View style={s.notReady}>
            <StatusLabel status={clip.status} />
            <Muted style={{ marginTop: space.sm, textAlign: 'center' }}>
              {clip.lastError ?? 'This clip is still on its way from the vest.'}
            </Muted>
          </View>
        )}
        {playable && <OverlayCanvas state={overlay} onChange={setOverlay} />}
      </View>

      {playable && (
        <View style={s.controls}>
          <Scrubber
            position={position}
            duration={duration}
            fps={fps}
            onScrub={seekTo}
            onScrubStart={() => {
              scrubbing.current = true;
              player?.pause();
            }}
            onScrubEnd={() => {
              scrubbing.current = false;
            }}
          />

          {/* Three keys. Step, play, step. */}
          <View style={s.transport}>
            <Key label="−1" hint="One frame back" onPress={() => step(-1)} repeat />
            <Key label={playing ? 'Pause' : 'Play'} hint={playing ? 'Pause' : 'Play'} onPress={togglePlay} primary />
            <Key label="+1" hint="One frame forward" onPress={() => step(1)} repeat />
          </View>

          {/* Everything else is one word that opens one panel. */}
          <View style={s.tabs}>
            <Tab
              label={speedLabel}
              open={panel === 'speed'}
              onPress={() => setPanel(panel === 'speed' ? 'none' : 'speed')}
            />
            <Tab
              label={lineCount > 0 ? `Lines · ${lineCount}` : 'Lines'}
              open={panel === 'lines'}
              onPress={() => setPanel(panel === 'lines' ? 'none' : 'lines')}
            />
            <Tab
              label={decisionLabel}
              open={panel === 'decision'}
              marked={decision !== null}
              onPress={() => setPanel(panel === 'decision' ? 'none' : 'decision')}
            />
          </View>

          {panel === 'speed' && (
            <Panel>
              {SPEEDS.map((o) => (
                <Option
                  key={o.rate}
                  label={o.label}
                  selected={speed === o.rate}
                  onPress={() => changeSpeed(o.rate)}
                />
              ))}
            </Panel>
          )}

          {panel === 'lines' && (
            <Panel>
              <Option
                label="Stump line"
                selected={overlay.showStumpLine}
                onPress={() => setOverlay({ ...overlay, showStumpLine: !overlay.showStumpLine })}
              />
              <Option
                label="Bail height"
                selected={overlay.showBailLine}
                onPress={() => setOverlay({ ...overlay, showBailLine: !overlay.showBailLine })}
              />
            </Panel>
          )}

          {panel === 'decision' && (
            <Panel>
              <Option label="Out" selected={decision === 'out'} onPress={() => void recordDecision('out')} />
              <Option label="Not out" selected={decision === 'not_out'} onPress={() => void recordDecision('not_out')} />
              <Option label="Unclear" selected={decision === 'inconclusive'} onPress={() => void recordDecision('inconclusive')} />
            </Panel>
          )}
        </View>
      )}
    </Screen>
  );
}

function Key({
  label, hint, onPress, primary = false, repeat = false,
}: {
  label: string; hint: string; onPress: () => void; primary?: boolean; repeat?: boolean;
}) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint}
      onPress={onPress}
      onLongPress={repeat ? () => { stop(); timer.current = setInterval(onPress, 90); } : undefined}
      onPressOut={stop}
      delayLongPress={280}
      style={({ pressed }) => [s.key, primary && s.keyPrimary, pressed && { opacity: 0.7 }]}
    >
      <Text style={[type.bodyStrong, { color: primary ? colors.textOnDark : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

function Tab({
  label, open, marked = false, onPress,
}: {
  label: string; open: boolean; marked?: boolean; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={label}
      style={({ pressed }) => [s.tab, open && s.tabOpen, pressed && { opacity: 0.6 }]}
    >
      <Text
        style={[
          type.caption,
          { color: open ? colors.text : marked ? colors.ready : colors.textMuted, fontWeight: open || marked ? '600' : '400' },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const Panel = ({ children }: { children: React.ReactNode }) => <View style={s.panel}>{children}</View>;

function Option({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [s.option, selected && s.optionOn, pressed && { opacity: 0.7 }]}
    >
      <Text style={[type.body, { color: selected ? colors.textOnDark : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

/** Route keys look like `vest-01_9`; camera ids contain hyphens, so split at the last underscore. */
function parseRouteKey(raw: string | undefined): { cameraId: string; seq: number } {
  const value = raw ?? '';
  const cut = value.lastIndexOf('_');
  if (cut < 0) return { cameraId: '', seq: Number(value) || -1 };
  return { cameraId: value.slice(0, cut), seq: Number(value.slice(cut + 1)) };
}

const s = StyleSheet.create({
  stage: { aspectRatio: 16 / 10, backgroundColor: colors.black, justifyContent: 'center' },
  notReady: { padding: space.xl, alignItems: 'center' },
  controls: { paddingTop: space.md, gap: space.lg },

  transport: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.xl },
  key: {
    flex: 1,
    minHeight: TOUCH_MIN,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPrimary: { flex: 1.8, backgroundColor: colors.accent, borderColor: colors.accent },

  tabs: {
    flexDirection: 'row',
    marginHorizontal: space.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.rule,
  },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
  tabOpen: { borderBottomWidth: 2, borderBottomColor: colors.text },

  panel: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.xl },
  option: {
    flexGrow: 1,
    flexBasis: '30%',
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionOn: { backgroundColor: colors.accent, borderColor: colors.accent },
});
