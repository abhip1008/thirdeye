import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { TOUCH_MIN, radius, space } from '@/theme/spacing';
import { type } from '@/theme/typography';

/**
 * Transport controls, laid out for one thumb.
 *
 * Play sits in the middle and is the largest target. The two frame-step buttons
 * flank it and repeat on hold, because stepping through an impact frame by
 * frame means twenty presses, not two.
 */
export function PlayerControls({
  playing,
  onTogglePlay,
  onStepBack,
  onStepForward,
  onJumpStart,
  onJumpEnd,
}: {
  playing: boolean;
  onTogglePlay: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onJumpStart: () => void;
  onJumpEnd: () => void;
}) {
  return (
    <View style={s.row}>
      <Key label="⏮" hint="Start" onPress={onJumpStart} />
      <Key label="−1" hint="Frame back" onPress={onStepBack} repeat />
      <Key
        label={playing ? 'Pause' : 'Play'}
        hint={playing ? 'Pause' : 'Play'}
        onPress={onTogglePlay}
        primary
      />
      <Key label="+1" hint="Frame forward" onPress={onStepForward} repeat />
      <Key label="⏭" hint="End" onPress={onJumpEnd} />
    </View>
  );
}

function Key({
  label,
  hint,
  onPress,
  primary = false,
  repeat = false,
}: {
  label: string;
  hint: string;
  onPress: () => void;
  primary?: boolean;
  repeat?: boolean;
}) {
  // Held in a ref, not a local: a local is reset on every render, which leaks
  // the interval and leaves the button repeating after the finger is lifted.
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
      onLongPress={
        repeat
          ? () => {
              stop();
              timer.current = setInterval(onPress, 90);
            }
          : undefined
      }
      onPressOut={stop}
      delayLongPress={280}
      style={({ pressed }) => [s.key, primary && s.keyPrimary, pressed && { opacity: 0.7 }]}
    >
      <Text style={[type.bodyStrong, { color: primary ? colors.textOnDark : colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.xl },
  key: {
    flex: 1,
    minHeight: TOUCH_MIN,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPrimary: { flex: 1.6, backgroundColor: colors.accent, borderColor: colors.accent },
});
