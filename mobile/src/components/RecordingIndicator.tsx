import { useEffect, useMemo } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/spacing';
import { type } from '@/theme/typography';

/**
 * Shown only while the vest is actually recording.
 *
 * The word RECORDING is not decoration next to the dot; it is the part that
 * works for someone who cannot see the red, in bright sun, at a glance. The
 * pulse is slow on purpose: fast blinking reads as an error.
 */
export function RecordingIndicator({ active }: { active: boolean }) {
  const pulse = useMemo(() => new Animated.Value(1), []);

  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  if (!active) return <View style={s.placeholder} />;

  return (
    <View style={s.wrap} accessibilityLiveRegion="polite" accessibilityLabel="Recording">
      <Animated.View style={[s.dot, { opacity: pulse }]} />
      <Text style={[type.captionStrong, { color: colors.recording }]}>RECORDING</Text>
    </View>
  );
}

const s = StyleSheet.create({
  // Reserves the same height when idle so nothing below it jumps.
  placeholder: { height: 34 },
  wrap: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: '#FBE9E7',
  },
  dot: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.recording },
});
