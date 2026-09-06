import { useLocalSearchParams, useRouter } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DecisionBar } from '@/components/DecisionBar';
import { Header } from '@/components/Header';
import { OverlayCanvas, OverlayState, defaultOverlay } from '@/components/OverlayCanvas';
import { PlayerControls } from '@/components/PlayerControls';
import { Scrubber } from '@/components/Scrubber';
import { StatusLabel } from '@/components/StatusDot';
import { EmptyState, Muted, Screen } from '@/components/ui';
import { FALLBACK_FPS } from '@/config/appConfig';
import { insertReview, reviewForClip } from '@/db/queries';
import { overBall } from '@/lib/format';
import { log } from '@/lib/log';
import { resolveVideoSource } from '@/mock/sampleAsset';
import { audit } from '@/privacy/audit';
import { useClips } from '@/stores/clipStore';
import { useMatch } from '@/stores/matchStore';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/spacing';
import { type } from '@/theme/typography';
import type { Decision } from '@/types/protocol';

const SPEEDS = [1, 0.5, 0.25, 0.125] as const;
const SPEED_LABELS = ['1x', '1/2x', '1/4x', '1/8x'];

/**
 * The review player. This is where the ninety seconds of a review actually go.
 *
 * Frame stepping is the feature that makes it worth opening at all, and it is
 * the one thing the spec warns can quietly not work. `expo-video` seeks exactly
 * by default - its `seekTolerance` is zero unless you widen it - so setting
 * `currentTime` to `t +/- 1/fps` lands on the requested frame rather than the
 * nearest keyframe. The bundled sample has a marker that moves a fixed distance
 * every single frame, so this is verifiable by eye rather than by hope.
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
  const [overlay, setOverlay] = useState<OverlayState>(defaultOverlay);
  const [decision, setDecision] = useState<Decision | null>(null);
  const scrubbing = useRef(false);

  const duration = clip?.duration_s ?? player?.duration ?? 0;

  /* Poll rather than subscribe: one timer, no event plumbing, and it stops
     the moment the screen goes away. */
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
    (seconds: number) => {
      if (!player) return;
      const clamped = Math.min(Math.max(0, seconds), Math.max(0, duration - frameStep));
      // Assignment is how expo-video seeks; the player is a handle on a native
      // object, not React state. Its default seekTolerance is zero, which is
      // what makes this land on the requested frame rather than a keyframe.
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
    },
    [player]
  );

  const recordDecision = useCallback(
    async (value: Decision) => {
      if (!match || !clip) return;
      setDecision(value);
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
        <EmptyState title="That clip is gone" body="It rolled out of the buffer and was deleted." />
      </Screen>
    );
  }

  const playable = clip.status === 'ready' && !!clip.localPath;

  return (
    <Screen>
      <Header
        title={`Ball ${clip.seq}`}
        subtitle={`Over ${overBall(clip.over, clip.ball_in_over)}`}
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
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={togglePlay}
            accessibilityLabel="Play or pause"
          >
            <VideoView
              style={StyleSheet.absoluteFill}
              player={player}
              nativeControls={false}
              contentFit="contain"
            />
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
        <>
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

            <PlayerControls
              playing={playing}
              onTogglePlay={togglePlay}
              onStepBack={() => step(-1)}
              onStepForward={() => step(1)}
              onJumpStart={() => seekTo(0)}
              onJumpEnd={() => seekTo(duration)}
            />

            <View style={s.speedRow}>
              {SPEEDS.map((rate, i) => (
                <Pressable
                  key={rate}
                  onPress={() => changeSpeed(rate)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: speed === rate }}
                  accessibilityLabel={`Speed ${SPEED_LABELS[i]}`}
                  style={({ pressed }) => [
                    s.speed,
                    speed === rate && s.speedOn,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text
                    style={[
                      type.bodyStrong,
                      { color: speed === rate ? colors.textOnDark : colors.text },
                    ]}
                  >
                    {SPEED_LABELS[i]}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={s.overlayRow}>
              <Toggle
                label="Stump line"
                on={overlay.showStumpLine}
                onPress={() => setOverlay({ ...overlay, showStumpLine: !overlay.showStumpLine })}
              />
              <Toggle
                label="Bail height"
                on={overlay.showBailLine}
                onPress={() => setOverlay({ ...overlay, showBailLine: !overlay.showBailLine })}
              />
            </View>
          </View>

          <DecisionBar value={decision} onChange={(d) => void recordDecision(d)} />
        </>
      )}
    </Screen>
  );
}

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      style={({ pressed }) => [s.toggle, on && s.toggleOn, pressed && { opacity: 0.7 }]}
    >
      <Text style={[type.body, { color: on ? colors.textOnDark : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Route keys look like `vest-01_9`. Camera ids contain hyphens, so the split is
 * at the last underscore, not the first.
 */
function parseRouteKey(raw: string | undefined): { cameraId: string; seq: number } {
  const value = raw ?? '';
  const cut = value.lastIndexOf('_');
  if (cut < 0) return { cameraId: '', seq: Number(value) || -1 };
  return { cameraId: value.slice(0, cut), seq: Number(value.slice(cut + 1)) };
}

const s = StyleSheet.create({
  stage: {
    aspectRatio: 16 / 10,
    backgroundColor: colors.black,
    justifyContent: 'center',
  },
  notReady: { padding: space.xl, alignItems: 'center' },
  controls: { paddingTop: space.md, gap: space.md },
  speedRow: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.xl },
  speed: {
    flex: 1,
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  overlayRow: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.xl },
  toggle: {
    flex: 1,
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleOn: { backgroundColor: colors.accent, borderColor: colors.accent },
});
