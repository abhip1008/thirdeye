import { useKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { BallCounter } from '@/components/BallCounter';
import { ClipRow } from '@/components/ClipRow';
import { ConnectionPill } from '@/components/ConnectionPill';
import { Button, EmptyState, Screen } from '@/components/ui';
import { MockTransport } from '@/mock/mockTransport';
import { disableScreenGuard, enableScreenGuard } from '@/privacy/screenGuard';
import { useClips } from '@/stores/clipStore';
import { useConnection } from '@/stores/connectionStore';
import { useDelivery } from '@/stores/deliveryStore';
import { useMatch } from '@/stores/matchStore';
import { usePairing } from '@/stores/pairingStore';
import { MOCK_INTERVALS, useSettings } from '@/stores/settingsStore';
import { colors } from '@/theme/colors';
import { TOUCH_MIN, radius, space } from '@/theme/spacing';
import { type } from '@/theme/typography';
import type { Clip } from '@/types/clip';

/**
 * Where the umpire spends the match.
 *
 * Four rules hold this screen together and none of them are negotiable:
 *
 *   1. No modal ever appears here. Dismissing a dialog while a captain is
 *      arguing is a failure of the product, not of the umpire.
 *   2. The list never reorders under a finger. New clips arrive at the top.
 *   3. Tapping a row navigates immediately. Loading happens on the next screen.
 *   4. The screen stays awake for as long as the match is open.
 *
 * The row actions are inline for rule 1: a long-press expands a strip under the
 * row rather than opening a sheet, so nothing is ever covering the list.
 */
export default function LiveScreen() {
  useKeepAwake();
  const router = useRouter();

  const match = useMatch((s) => s.match);
  const over = useMatch((s) => s.over);
  const ballInOver = useMatch((s) => s.ballInOver);
  const deliveryCount = useMatch((s) => s.deliveryCount);

  const clips = useClips((s) => s.clips);
  const connection = useConnection();
  const settings = useSettings();
  const pairing = usePairing();

  const delivery = useDelivery((s) => s.ctx);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const transportRef = useRef<MockTransport | null>(null);

  /* Screen capture is blocked while a match is open; see privacy/screenGuard. */
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

  const held = useMemo(() => clips.filter((c) => c.status === 'ready').length, [clips]);

  /* The phone owns the delivery state machine now, so the vest agreeing is not
     news. The vest *disagreeing* is - it means a marker did not land, and the
     umpire should know before they rely on the next clip. */
  const vestDisagrees =
    connection.state === 'connected' && connection.recording !== (delivery.state === 'recording');

  if (!match) {
    return (
      <Screen>
        <EmptyState
          title="No match running"
          body="Start a match to begin recording deliveries."
        />
        <View style={s.footer}>
          <Button label="Set up a match" onPress={() => router.replace('/setup')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={s.topBar}>
        <Pressable
          onPress={() => router.push('/settings')}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={12}
          style={({ pressed }) => pressed && { opacity: 0.5 }}
        >
          <Text style={[type.body, { color: colors.accent }]}>Settings</Text>
        </Pressable>

        <Text style={[type.caption, { color: colors.textMuted }]} numberOfLines={1}>
          {match.name}
        </Text>

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

      <View style={s.pill}>
        <ConnectionPill
          state={connection.state}
          health={connection.health}
          onPress={() => router.push('/diagnostics')}
        />
        {vestDisagrees && (
          <Text style={[type.caption, s.disagree]}>
            The vest does not agree about whether a ball is live. Check diagnostics.
          </Text>
        )}
      </View>

      {correcting ? (
        <CounterCorrection
          over={over}
          ballInOver={ballInOver}
          onDone={() => setCorrecting(false)}
        />
      ) : (
        <BallCounter
          over={over}
          ballInOver={ballInOver}
          deliveries={deliveryCount}
          onCorrect={() => setCorrecting(true)}
          onResetOver={() => useMatch.getState().resetOver()}
        />
      )}

      <View style={s.listHeader}>
        <Text style={[type.captionStrong, { color: colors.textMuted }]}>
          LAST {settings.ringSize} BALLS
        </Text>
        <View style={s.listHeaderRight}>
          <Text style={[type.numeralSmall, { color: colors.textMuted }]}>{held} ready</Text>
          <Pressable
            onPress={() => transportRef.current?.grabLastSeconds()}
            accessibilityRole="button"
            accessibilityLabel="Grab the last twenty seconds"
            hitSlop={10}
            style={({ pressed }) => pressed && { opacity: 0.5 }}
          >
            <Text style={[type.captionStrong, { color: colors.accent }]}>GRAB ONE</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={clips}
        keyExtractor={(c) => `${c.camera_id}:${c.seq}`}
        style={s.list}
        contentContainerStyle={clips.length === 0 && s.listEmpty}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
        ListEmptyComponent={
          <EmptyState
            title="Waiting for the first ball"
            body="Clips appear here as they are bowled. The newest is always at the top."
          />
        }
        renderItem={({ item }) => (
          <View>
            <ClipRow
              clip={item}
              onPress={() => router.push(`/clip/${item.camera_id}_${item.seq}`)}
              onLongPress={() => setOpenRow(openRow === item.seq ? null : item.seq)}
            />
            {openRow === item.seq && (
              <RowActions clip={item} onClose={() => setOpenRow(null)} />
            )}
          </View>
        )}
      />

    </Screen>
  );
}

/**
 * Inline row actions. Appears under the row it belongs to, pushes the list
 * down, and disappears on the next tap. No sheet, no overlay, no dismiss step.
 */
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
        <>
          <Action
            label="Keep · wicket"
            onPress={() => act(() => store.pin(clip.camera_id, clip.seq, 'wicket'))}
          />
          <Action
            label="Keep · review"
            onPress={() => act(() => store.pin(clip.camera_id, clip.seq, 'review'))}
          />
        </>
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

/** Correcting the count, inline, because the alternative is a dialog. */
function CounterCorrection({
  over,
  ballInOver,
  onDone,
}: {
  over: number;
  ballInOver: number;
  onDone: () => void;
}) {
  const setOverBall = useMatch((s) => s.setOverBall);
  return (
    <View style={s.correction}>
      <Stepper
        label="Over"
        value={over}
        onChange={(v) => setOverBall(v, ballInOver)}
      />
      <Stepper
        label="Ball"
        value={ballInOver}
        onChange={(v) => setOverBall(over, v)}
      />
      <Pressable
        onPress={onDone}
        accessibilityRole="button"
        accessibilityLabel="Done correcting"
        style={({ pressed }) => [s.doneBtn, pressed && { opacity: 0.6 }]}
      >
        <Text style={[type.bodyStrong, { color: colors.accent }]}>Done</Text>
      </Pressable>
    </View>
  );
}

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <View style={s.stepper}>
      <Text style={[type.caption, { color: colors.textMuted }]}>{label}</Text>
      <View style={s.stepperRow}>
        <Pressable
          onPress={() => onChange(value - 1)}
          accessibilityRole="button"
          accessibilityLabel={`${label} down`}
          style={({ pressed }) => [s.stepBtn, pressed && { opacity: 0.6 }]}
        >
          <Text style={type.bodyStrong}>−</Text>
        </Pressable>
        <Text style={[type.numeral, s.stepValue]}>{value}</Text>
        <Pressable
          onPress={() => onChange(value + 1)}
          accessibilityRole="button"
          accessibilityLabel={`${label} up`}
          style={({ pressed }) => [s.stepBtn, pressed && { opacity: 0.6 }]}
        >
          <Text style={type.bodyStrong}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: space.md,
  },
  pill: { paddingBottom: space.sm },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: space.lg,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  listHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  disagree: { color: colors.danger, paddingTop: space.sm },
  list: { flex: 1 },
  listEmpty: { flexGrow: 1 },
  footer: { paddingVertical: space.lg },

  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingBottom: space.md,
    paddingLeft: 32,
  },
  action: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },

  correction: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: space.xl,
    paddingVertical: space.lg,
  },
  stepper: { alignItems: 'center', gap: space.xs },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { minWidth: 28, textAlign: 'center' },
  doneBtn: { minHeight: TOUCH_MIN, justifyContent: 'center' },
});
