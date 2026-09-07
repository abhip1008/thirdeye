import { useKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ClipRow } from '@/components/ClipRow';
import { EmptyState, Screen } from '@/components/ui';
import { percent } from '@/lib/format';
import { MockTransport } from '@/mock/mockTransport';
import { disableScreenGuard, enableScreenGuard } from '@/privacy/screenGuard';
import { useClips } from '@/stores/clipStore';
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
  const transportRef = useRef<MockTransport | null>(null);

  useEffect(() => {
    if (settings.screenGuard) void enableScreenGuard();
    return () => {
      void disableScreenGuard();
    };
  }, [settings.screenGuard]);

  /* Attach the mock vest. Phase 3 swaps MockTransport for the WebSocket client. */
  useEffect(() => {
    if (!match || !settings.mockEnabled) return;
    const transport = new MockTransport({
      matchId: match.id,
      cameraId: pairing.cameraId ?? match.cameraId,
      ballIntervalSeconds: MOCK_INTERVALS[settings.mockSpeed],
      startingSeq: useClips.getState().clips[0]?.seq ?? 0,
    });
    transportRef.current = transport;
    useConnection.getState().attach(transport);
    return () => {
      useConnection.getState().detach();
      transportRef.current = null;
    };
  }, [match, settings.mockEnabled, settings.mockSpeed, pairing.cameraId]);

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

        {/* Link and battery only. Temperature, frame rate and the rest live on
            the diagnostics screen, where someone is actually looking for them. */}
        <Pressable
          onPress={() => router.push('/diagnostics')}
          accessibilityRole="button"
          accessibilityLabel={`Link ${state}. Diagnostics.`}
          hitSlop={12}
          style={({ pressed }) => [s.link, pressed && { opacity: 0.5 }]}
        >
          <View style={[s.dot, { backgroundColor: linkTint }]} />
          {health ? (
            <Text style={[type.caption, { color: colors.textMuted }]}>
              {percent(health.battery_pct)}
            </Text>
          ) : null}
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
        {/* Just a count. "N of the last 12" reads as nonsense once kept and
            reviewed clips push the total past the ring size. */}
        <Text style={[type.caption, { color: colors.textMuted }]}>
          {ready === 0 ? 'Nothing yet' : `${ready} ready`}
        </Text>
        <Pressable
          onPress={() => transportRef.current?.grabLastSeconds()}
          accessibilityRole="button"
          accessibilityLabel="Grab the last twenty seconds"
          hitSlop={10}
          style={({ pressed }) => pressed && { opacity: 0.5 }}
        >
          <Text style={[type.caption, { color: colors.accent }]}>Grab one</Text>
        </Pressable>
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
  link: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 9, height: 9, borderRadius: 5 },

  listHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: space.xl,
    paddingBottom: space.md,
  },
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
