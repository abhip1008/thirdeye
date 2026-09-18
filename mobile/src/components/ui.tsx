import { Children, isValidElement, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/theme/colors';
import { TOUCH_MIN, radius, space } from '@/theme/spacing';
import { type } from '@/theme/typography';

/**
 * The whole visual vocabulary of the app: a screen, a title, some text, a
 * button, a field, a divider. Nothing here has a shadow, a gradient or an
 * animation. It is meant to be read in sunlight at arm's length by someone who
 * is not looking at it for long.
 */

export function Screen({
  children,
  scroll = false,
  style,
}: {
  children?: ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
}) {
  const inner = <View style={[s.screenBody, style]}>{children}</View>;
  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

export const Title = ({ children, style }: { children: ReactNode; style?: TextStyle }) => (
  <Text style={[type.title, { color: colors.text }, style]}>{children}</Text>
);

export const Body = ({ children, style }: { children: ReactNode; style?: TextStyle }) => (
  <Text style={[type.body, { color: colors.text }, style]}>{children}</Text>
);

export const Muted = ({ children, style }: { children: ReactNode; style?: TextStyle }) => (
  <Text style={[type.caption, { color: colors.textMuted, lineHeight: 19 }, style]}>{children}</Text>
);

export const SectionLabel = ({ children }: { children: ReactNode }) => (
  <Text style={[type.captionStrong, s.sectionLabel]}>{String(children).toUpperCase()}</Text>
);

export const Divider = () => <View style={s.divider} />;

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.button,
        variant === 'primary' && s.buttonPrimary,
        variant === 'secondary' && s.buttonSecondary,
        variant === 'danger' && s.buttonDanger,
        variant === 'ghost' && s.buttonGhost,
        pressed && !disabled && s.buttonPressed,
        disabled && s.buttonDisabled,
        style,
      ]}
    >
      <Text
        style={[
          type.bodyStrong,
          variant === 'primary' || variant === 'danger'
            ? { color: colors.textOnDark }
            : { color: colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A row of equal-width choices. Used for speed, decision, and short pickers. */
export function Choice<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  size?: 'md' | 'lg';
}) {
  return (
    <View style={s.choiceRow}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [
              s.choice,
              size === 'lg' && s.choiceLarge,
              selected && s.choiceSelected,
              pressed && s.buttonPressed,
            ]}
          >
            <Text
              style={[
                size === 'lg' ? type.bodyStrong : type.body,
                { color: selected ? colors.textOnDark : colors.text },
              ]}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  keyboardType,
  autoFocus,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  hint?: string;
  keyboardType?: 'default' | 'numeric';
  autoFocus?: boolean;
  autoCapitalize?: 'none' | 'sentences';
}) {
  return (
    <View style={s.field}>
      <SectionLabel>{label}</SectionLabel>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        autoFocus={autoFocus}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        style={[type.body, s.input]}
        accessibilityLabel={label}
      />
      {hint ? <Muted style={{ marginTop: space.xs }}>{hint}</Muted> : null}
    </View>
  );
}

/** A tappable settings line: label on the left, current value on the right. */
export function SettingRow({
  label,
  value,
  hint,
  onPress,
  destructive = false,
}: {
  label: string;
  value?: string;
  hint?: string;
  onPress?: () => void;
  destructive?: boolean;
}) {
  const content = (
    <View style={s.settingRow}>
      <View style={s.settingText}>
        <Text
          style={[type.body, { color: destructive ? colors.danger : colors.text }]}
        >
          {label}
        </Text>
        {hint ? <Muted style={{ marginTop: 2 }}>{hint}</Muted> : null}
      </View>
      {value ? <Text style={[type.numeralSmall, { color: colors.textMuted }]}>{value}</Text> : null}
      {/* Only where tapping goes somewhere. A chevron on a row that does nothing
          is a promise the row does not keep. */}
      {onPress && !destructive ? (
        <Text style={[type.body, s.chevron]} accessibilityElementsHidden>
          ›
        </Text>
      ) : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => pressed && { backgroundColor: colors.surface }}
    >
      {content}
    </Pressable>
  );
}

/**
 * A grouped card, the way a settings screen has looked on a phone for fifteen
 * years: related rows inside one rounded block, hairlines between them, nothing
 * between the groups but space.
 *
 * It exists because the alternative - a flat run of rows with the occasional
 * divider - gives the eye no way to tell which heading a row belongs to, and
 * the screen reads as one long list of unrelated switches.
 *
 * Separators are inserted here rather than by each row, so no call site has to
 * know whether it is last.
 */
export function Card({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={s.card}>
      {rows.map((row, index) => (
        <View key={index} style={index > 0 ? s.cardRow : undefined}>
          {row}
        </View>
      ))}
    </View>
  );
}

/**
 * A setting that is on or off, with the switch where a thumb expects it.
 *
 * The first version of this screen put the label in one row and the switch in
 * the next, left-aligned underneath. It worked, and it looked like a form that
 * had been assembled rather than designed - and worse, with several in a column
 * it stopped being obvious which switch belonged to which label.
 */
export function ToggleRow({
  label,
  hint,
  value,
  onValueChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={s.settingRow}>
      <View style={s.settingText}>
        <Text style={[type.body, { color: colors.text }]}>{label}</Text>
        {hint ? <Muted style={{ marginTop: 2 }}>{hint}</Muted> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        accessibilityLabel={label}
        style={{ marginLeft: space.md }}
      />
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={s.empty}>
      <Text style={[type.bodyStrong, { color: colors.text, textAlign: 'center' }]}>{title}</Text>
      <Muted style={{ textAlign: 'center', marginTop: space.sm, maxWidth: 320 }}>{body}</Muted>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
    marginBottom: space.xl,
    paddingHorizontal: space.lg,
  },
  cardRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.rule },
  chevron: { color: colors.textMuted, marginLeft: space.sm },
  screen: { flex: 1, backgroundColor: colors.bg },
  screenBody: { flex: 1, paddingHorizontal: space.xl },
  scrollContent: { flexGrow: 1, paddingBottom: space.xxl },

  sectionLabel: { color: colors.textMuted, marginBottom: space.sm },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },

  button: {
    minHeight: TOUCH_MIN,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonSecondary: { backgroundColor: colors.bg, borderWidth: 1.5, borderColor: colors.borderStrong },
  buttonDanger: { backgroundColor: colors.danger },
  buttonGhost: { backgroundColor: 'transparent' },
  buttonPressed: { opacity: 0.72 },
  buttonDisabled: { opacity: 0.38 },

  choiceRow: { flexDirection: 'row', gap: space.sm },
  choice: {
    flex: 1,
    minHeight: TOUCH_MIN - 8,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceLarge: { minHeight: TOUCH_MIN + 4 },
  choiceSelected: { backgroundColor: colors.accent, borderColor: colors.accent },

  field: { marginBottom: space.xl },
  input: {
    minHeight: TOUCH_MIN,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    color: colors.text,
    backgroundColor: colors.bg,
  },

  settingRow: {
    minHeight: TOUCH_MIN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
    gap: space.lg,
  },
  settingText: { flex: 1 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
});
