import { useKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { ClipRow } from '@/components/ClipRow';
import { defaults } from '@/config/appConfig';
import { EmptyState, Screen } from '@/components/ui';
import { MockDownloader } from '@/mock/mockDownloader';
import { MockTransport } from '@/mock/mockTransport';
import { HttpDownloader } from '@/net/httpDownloader';
import type { Transport } from '@/net/transport';
import { startVestSession } from '@/net/vestApi';
import { WebSocketTransport } from '@/net/wsClient';
import { disableScreenGuard, enableScreenGuard } from '@/privacy/screenGuard';
import { setDownloader, useClips } from '@/stores/clipStore';
import { useConnection } from '@/stores/connectionStore';
import { useMatch } from '@/stores/matchStore';
import { usePairing } from '@/stores/pairingStore';
import { MOCK_INTERVALS, useSettings } from '@/stores/settingsStore';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/spacing';
import { type } from '@/theme/typography';
import type { Clip } from '@/types/clip';

/**
 * Where the umpire spends the match: the last twelve balls, and the control.
 *
 * Deliberately almost empty. There is no over-and-ball counter, no delivery
 * total and nothing to correct - the umpire already knows the score and does
 * not need the phone's opinion of it. What they cannot know without looking is
 * whether a clip exists, and that is all this screen is for.
 *
 * Four rules hold it together and none are negotiable:
 *
 *   1. No modal ever appears here. Dismissing a dialog while a captain is
 *      arguing is a failure of the product, so row actions expand inline.
 *   2. The list never reorders under a finger. New clips arrive at the top.
 *   3. Tapping a row navigates instantly. Loading happens on the next screen.
 *   4. The screen stays awake for as long as the match is open.
 */
export default function LiveScreen() {
  useKeepAwake();
  const router = useRouter();

  const match = useMatch((s) => s.match);
  const clips = useClips((s) => s.clips);
  const state = useConnection((s) => s.state);
  const health = useConnection((s) => s.health);
  const settings = useSettings();
  const pairing = usePairing();

  const [openRow, setOpenRow] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (settings.screenGuard) void enableScreenGuard();
    return () => {
      void disableScreenGuard();
    };
  }, [settings.screenGuard]);

  /* The one place that decides whether this app is talking to a real vest or a
     pretend one. Everything below it - the stores, the marker queue, the
     retention rules, every screen - is written against the interfaces and does
     not know the difference. */
  useEffect(() => {
    if (!match) return;
    let cancelled = false;

    if (settings.mockEnabled) {
      const transport = new MockTransport({
        matchId: match.id,
        cameraId: pairing.cameraId ?? match.cameraId,
        ballIntervalSeconds: MOCK_INTERVALS[settings.mockSpeed],
        startingSeq: useClips.getState().clips[0]?.seq ?? 0,
      });
      setDownloader(new MockDownloader());
      useConnection.getState().attach(transport);
      return () => useConnection.getState().detach();
    }

    const host = pairing.host;
    if (!host) return;

    const transport: Transport = new WebSocketTransport(host, defaults.reconnectBackoffMs);
    setDownloader(new HttpDownloader(host));
    // The vest refuses markers outside a match, so tell it one has begun before
    // the umpire can tap anything. If it is unreachable the taps still queue.
    void startVestSession(host, match.venue ?? '').then(() => {
      if (!cancelled) useConnection.getState().attach(transport);
    });

    return () => {
      cancelled = true;
      useConnection.getState().detach();
    };
  }, [match, settings.mockEnabled, settings.mockSpeed, pairing.cameraId, pairing.host]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    useConnection.getState().resync();
    if (match) await useClips.getState().hydrate(match.id);
    setRefreshing(false);
  }, [match]);

  const ready = useMemo(() => clips.filter((c) => c.status === 'ready').length, [clips]);

  if (!match) {
    return (
      <Screen>
        <EmptyState title="No match running" body="Start a match to begin recording deliveries." />
      </Screen>
    );
  }

  const linkTint =
    state === 'connected' ? colors.ready : state === 'disconnected' ? colors.missing : colors.pending;

  return (
    <Screen>
      <View style={s.top}>
        <Pressable
          onPress={() => router.push('/settings')}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={12}
          style={({ pressed }) => pressed && { opacity: 0.5 }}
        >
          <Text style={[type.body, { color: colors.accent }]}>Settings</Text>
        </Pressable>

        {/* Link and vest battery only. Temperature, frame rate and the rest
            live on the diagnostics screen, where someone is looking for them. */}
        <Pressable
          onPress={() => router.push('/diagnostics')}
          accessibilityRole="button"
          accessibilityLabel={
            health
              ? `Link ${state}. Vest battery ${Math.round(health.battery_pct)} percent. Diagnostics.`
              : `Link ${state}. Diagnostics.`
          }
          hitSlop={12}
          style={({ pressed }) => [s.link, pressed && { opacity: 0.5 }]}
        >
          <View style={[s.dot, { backgroundColor: linkTint }]} />
          {health ? <VestBattery percent={health.battery_pct} /> : null}
        </Pressable>

        <Pressable
          onPress={() => router.push('/summary')}
          accessibilityRole="button"
          accessibilityLabel="End match"
          hitSlop={12}
          style={({ pressed }) => pressed && { opacity: 0.5 }}
        >
          <Text style={[type.body, { color: colors.accent }]}>End</Text>
        </Pressable>
      </View>

      <View style={s.listHead}>
        <Text style={[type.caption, { color: colors.textMuted }]}>
          {ready === 0 ? 'Nothing yet' : `${ready} ready`}
        </Text>
      </View>

      <FlatList
        data={clips}
        keyExtractor={(c) => `${c.camera_id}:${c.seq}`}
        style={s.list}
        contentContainerStyle={clips.length === 0 && s.listEmpty}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
        ListEmptyComponent={
          <EmptyState
            title="Waiting for the first ball"
            body="Tap the button below as the bowler runs in. Clips appear here, newest first."
          />
        }
        renderItem={({ item }) => (
          <View>
            <ClipRow
              clip={item}
              onPress={() => router.push(`/clip/${item.camera_id}_${item.seq}`)}
              onLongPress={() => setOpenRow(openRow === item.seq ? null : item.seq)}
            />
            {openRow === item.seq && <RowActions clip={item} onClose={() => setOpenRow(null)} />}
          </View>
        )}
      />
    </Screen>
  );
}

/**
 * The vest's battery, not the phone's.
 *
 * It was a bare percentage next to a coloured dot, and the first person to see
 * it asked what it meant - which is a fair question of a number with no unit
 * beside a dot that could stand for anything. The glyph says which quantity it
 * is without spending a word on it, and it is the one indicator here that is
 * about the thing on the umpire's chest rather than the thing in their hand.
 *
 * It fills and empties as well as changing colour, so it still reads when the
 * red does not.
 */
function VestBattery({ percent: pct }: { percent: number }) {
  const level = Math.max(0, Math.min(100, pct));
  const low = level <= 20;
  const tint = low ? colors.danger : colors.textMuted;

  return (
    <View style={s.battery}>
      <Svg width={22} height={11}>
        <Rect x={0.5} y={0.5} width={18} height={10} rx={2.5} stroke={tint} strokeWidth={1} fill="none" />
        <Rect x={20} y={3.5} width={2} height={4} rx={1} fill={tint} />
        <Rect x={2} y={2} width={(level / 100) * 15} height={7} rx={1} fill={tint} />
      </Svg>
      <Text style={[type.caption, { color: tint }]}>{Math.round(level)}%</Text>
    </View>
  );
}

/** Inline row actions. Nothing ever covers the list. */
function RowActions({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  const store = useClips();
  const act = async (fn: () => Promise<void>) => {
    await fn();
    onClose();
  };

  return (
    <View style={s.actions}>
      {clip.pinned ? (
        <Action label="Stop keeping" onPress={() => act(() => store.unpin(clip.camera_id, clip.seq))} />
      ) : (
        <Action
          label="Keep this one"
          onPress={() => act(() => store.pin(clip.camera_id, clip.seq, 'wicket'))}
        />
      )}
      {clip.status === 'failed' && (
        <Action label="Try again" onPress={() => act(() => store.retry(clip.camera_id, clip.seq))} />
      )}
    </View>
  );
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [s.action, pressed && { opacity: 0.6 }]}
    >
      <Text style={[type.caption, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
  },
  link: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  battery: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 9, height: 9, borderRadius: 5 },

  listHead: { paddingTop: space.xl, paddingBottom: space.md },
  list: { flex: 1 },
  listEmpty: { flexGrow: 1 },

  actions: { flexDirection: 'row', gap: space.sm, paddingBottom: space.md, paddingLeft: 36 },
  action: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
});
