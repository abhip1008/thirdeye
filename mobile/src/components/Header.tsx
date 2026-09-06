import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { TOUCH_MIN, space } from '@/theme/spacing';
import { type } from '@/theme/typography';

/**
 * A back arrow, a title, and at most one action. Deliberately plain: every
 * pixel of chrome is a pixel not showing the umpire a clip.
 */
export function Header({
  title,
  subtitle,
  action,
  onBack,
}: {
  title: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void; tint?: string };
  onBack?: () => void;
}) {
  const router = useRouter();
  const back = onBack ?? (() => router.back());

  return (
    <View style={s.wrap}>
      <Pressable
        onPress={back}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={12}
        style={({ pressed }) => [s.back, pressed && { opacity: 0.5 }]}
      >
        <Text style={[type.bodyStrong, { color: colors.accent }]}>‹ Back</Text>
      </Pressable>

      <View style={s.titles}>
        <Text style={[type.bodyStrong, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[type.caption, { color: colors.textMuted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      <View style={s.action}>
        {action ? (
          <Pressable
            onPress={action.onPress}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            hitSlop={12}
            style={({ pressed }) => pressed && { opacity: 0.5 }}
          >
            <Text style={[type.bodyStrong, { color: action.tint ?? colors.accent }]}>
              {action.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    minHeight: TOUCH_MIN,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    gap: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  back: { minWidth: 72 },
  titles: { flex: 1, alignItems: 'center' },
  action: { minWidth: 72, alignItems: 'flex-end' },
});
