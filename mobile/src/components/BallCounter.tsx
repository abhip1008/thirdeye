import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { space } from '@/theme/spacing';
import { type } from '@/theme/typography';

/**
 * Over and ball, in the largest type in the app.
 *
 * Tap to correct it, long-press to reset the over. It will drift: the phone
 * counts START presses and the vest has no idea what a wide is, so the umpire
 * has to be able to fix it without leaving the screen and without a dialog.
 */
export function BallCounter({
  over,
  ballInOver,
  deliveries,
  onCorrect,
  onResetOver,
}: {
  over: number;
  ballInOver: number;
  deliveries: number;
  onCorrect: () => void;
  onResetOver: () => void;
}) {
  return (
    <Pressable
      onPress={onCorrect}
      onLongPress={onResetOver}
      delayLongPress={600}
      accessibilityRole="button"
      accessibilityLabel={`Over ${over}, ball ${ballInOver}. ${deliveries} deliveries. Tap to correct.`}
      style={({ pressed }) => [s.wrap, pressed && { opacity: 0.6 }]}
    >
      <Text style={[type.counterHuge, { color: colors.text }]}>
        {over}.{ballInOver}
      </Text>
      <View style={s.sub}>
        <Text style={[type.caption, { color: colors.textMuted }]}>
          {deliveries} {deliveries === 1 ? 'delivery' : 'deliveries'} · tap to correct
        </Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: space.lg },
  sub: { marginTop: space.xs },
});
