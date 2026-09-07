import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { elapsed } from '@/lib/delivery';
import { useDelivery } from '@/stores/deliveryStore';
import { useConnection } from '@/stores/connectionStore';
import { colors } from '@/theme/colors';
import { space } from '@/theme/spacing';
import { type } from '@/theme/typography';

/**
 * The control that replaced the remote.
 *
 * One target, filling the bottom of the screen, in the same place on every
 * screen it appears on. That is not a style choice: an umpire has to be able to
 * hit it without looking, with one hand, while the other arm is free to signal.
 * A physical button could be pressed blind, and this has to earn that back with
 * size and position.
 *
 * It is a toggle rather than two buttons because a toggle cannot be pressed in
 * the wrong order. With two targets on glass, a mis-tap produces a marker that
 * says the opposite of what happened and nothing downstream can tell.
 *
 * The button is also the recording indicator. State and control are the same
 * object, so there is nothing to cross-check and nothing to disagree.
 */
export function DeliveryBar() {
  const insets = useSafeAreaInsets();
  const ctx = useDelivery((s) => s.ctx);
  const queued = useDelivery((s) => s.queued);
  const abandoned = useDelivery((s) => s.abandoned);
  const busy = useDelivery((s) => s.busy);
  const state = useConnection((s) => s.state);

  const recording = ctx.state === 'recording';
  const pulse = useMemo(() => new Animated.Value(1), []);

  /* One timer while a ball is live. It advances the clock the read-out is
     derived from, and gives the store a chance to auto-close a delivery nobody
     ended. Nothing runs while idle. */
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      setNow(useConnection.getState().vestNow());
      void useDelivery.getState().tick();
    }, 250);
    return () => clearInterval(id);
  }, [recording]);

  // Derived, not stored: elapsed() already reports zero when idle.
  const seconds = elapsed(ctx, now);

  useEffect(() => {
    if (!recording) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [recording, pulse]);

  const offline = state !== 'connected';

  return (
    <View style={[s.wrap, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
      {(queued > 0 || abandoned > 0 || offline) && (
        <View style={s.strip}>
          <Text style={[type.caption, { color: colors.textMuted }]} numberOfLines={1}>
            {queued > 0
              ? `${queued} tap${queued === 1 ? '' : 's'} waiting for the vest · the footage is safe`
              : abandoned > 0
                ? `${abandoned} tap${abandoned === 1 ? '' : 's'} arrived too late to recover`
                : 'Not connected · taps are being saved'}
          </Text>
        </View>
      )}

      <Pressable
        onPress={() => {
          /* A physical remote confirmed itself by feel, which is what let an
             umpire press it without looking. Glass gives nothing back, so the
             confirmation has to come through the only channel left. Heavier on
             the start of a ball than the end, so the two are distinguishable in
             a pocket. */
          void Haptics.impactAsync(
            recording ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Heavy
          ).catch(() => {});
          void useDelivery.getState().press();
        }}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ busy }}
        accessibilityLabel={
          recording
            ? `Ball in play, ${Math.round(seconds)} seconds. Tap when the ball is dead.`
            : 'Tap as the bowler runs in, to start recording the delivery.'
        }
        style={({ pressed }) => [
          s.button,
          recording ? s.recording : s.idle,
          pressed && { opacity: 0.82 },
        ]}
      >
        <View style={s.labels}>
          {recording && <Animated.View style={[s.dot, { opacity: pulse }]} />}
          <View>
            <Text style={[type.bodyStrong, s.title]}>
              {recording ? 'BALL IN PLAY' : 'START THE BALL'}
            </Text>
            <Text style={[type.caption, s.hint]}>
              {recording ? 'tap when the ball is dead' : 'tap as the bowler runs in'}
            </Text>
          </View>
        </View>

        {recording && (
          <Text style={[type.counterHuge, s.clock]}>{seconds.toFixed(1)}</Text>
        )}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    gap: space.sm,
  },
  strip: { paddingHorizontal: space.xs },
  button: {
    minHeight: 92,
    borderRadius: 12,
    paddingHorizontal: space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  idle: { backgroundColor: colors.accent },
  recording: { backgroundColor: colors.recording },
  labels: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexShrink: 1 },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.textOnDark },
  title: { color: colors.textOnDark, letterSpacing: 0.6, fontSize: 18 },
  hint: { color: colors.textOnDark, opacity: 0.85, marginTop: 2 },
  clock: { color: colors.textOnDark, fontSize: 34 },
});
