import { Pressable, StyleSheet, Text, View } from 'react-native';

import { percent } from '@/lib/format';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/spacing';
import { type } from '@/theme/typography';
import type { ConnectionState, HealthSnapshot } from '@/types/protocol';

const COPY: Record<ConnectionState, { label: string; tint: string }> = {
  connected: { label: 'Connected', tint: colors.ready },
  connecting: { label: 'Connecting', tint: colors.pending },
  reconnecting: { label: 'Reconnecting', tint: colors.pending },
  disconnected: { label: 'Offline', tint: colors.missing },
};

/**
 * Link state and vest health in one line across the top of the live screen.
 *
 * Battery and temperature sit here rather than behind a menu because both of
 * them fail slowly: an umpire who can see 22% at the start of an over can plan
 * around it, and an umpire who finds out at 0% cannot.
 */
export function ConnectionPill({
  state,
  health,
  onPress,
}: {
  state: ConnectionState;
  health: HealthSnapshot | null;
  onPress: () => void;
}) {
  const { label, tint } = COPY[state];
  const hot = (health?.temp_c ?? 0) >= 70;
  const low = (health?.battery_pct ?? 100) <= 20;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Link ${label}. Diagnostics.`}
      style={({ pressed }) => [s.bar, pressed && { backgroundColor: colors.surfaceSunk }]}
    >
      <View style={[s.dot, { backgroundColor: tint }]} />
      <Text style={[type.captionStrong, { color: colors.text }]}>{label}</Text>

      <View style={s.spacer} />

      {health && (
        <>
          <Text style={[type.numeralSmall, { color: low ? colors.danger : colors.textMuted }]}>
            {percent(health.battery_pct)}
          </Text>
          <Text style={[type.numeralSmall, { color: hot ? colors.danger : colors.textMuted }]}>
            {health.temp_c.toFixed(0)}°
          </Text>
          <Text style={[type.numeralSmall, { color: colors.textMuted }]}>
            {health.encoder_fps.toFixed(0)} fps
          </Text>
        </>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  spacer: { flex: 1 },
});
