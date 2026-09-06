import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { DotState, dotLabelFor, dotStateFor } from '@/lib/clipStatus';
import { colors } from '@/theme/colors';
import { space } from '@/theme/spacing';
import { type } from '@/theme/typography';
import type { ClipStatus } from '@/types/protocol';

/**
 * The single most important pixel in the app.
 *
 * The umpire has to know a clip exists *before* announcing a review. A review
 * announced against a clip that turns out to be missing is the worst thing that
 * can happen to this product on a field, and this dot is what prevents it.
 *
 * Three states, and each differs in three ways at once: hue, fill, and word.
 * Anyone who cannot separate the greens from the ambers reads the shape; anyone
 * who cannot read the shape at a glance reads the word.
 *
 *   filled circle  + green + "Ready"        the bytes are here, it will play now
 *   half circle    + amber + "Getting it"   on its way, tappable, shows progress
 *   hollow circle  + grey  + "Not here"     failed or gone, nothing to watch
 */

export { dotLabelFor, dotStateFor };
export type { DotState };

const TINT: Record<DotState, string> = {
  ready: colors.ready,
  pending: colors.pending,
  missing: colors.missing,
};

export function StatusDot({ status, size = 14 }: { status: ClipStatus; size?: number }) {
  const state = dotStateFor(status);
  const tint = TINT[state];
  const r = size / 2 - 1.5;
  const c = size / 2;

  return (
    <Svg width={size} height={size} accessibilityLabel={dotLabelFor(status)}>
      <Circle cx={c} cy={c} r={r} stroke={tint} strokeWidth={2} fill="none" />
      {state === 'ready' && <Circle cx={c} cy={c} r={r} fill={tint} />}
      {state === 'pending' && (
        // Left half filled: readable as "part way there" without any colour.
        <Path d={`M ${c} ${c - r} A ${r} ${r} 0 0 0 ${c} ${c + r} Z`} fill={tint} />
      )}
    </Svg>
  );
}

/** Dot plus word. Use this anywhere the status needs to be unambiguous. */
export function StatusLabel({ status }: { status: ClipStatus }) {
  const state = dotStateFor(status);
  return (
    <View style={s.row}>
      <StatusDot status={status} />
      <Text style={[type.captionStrong, { color: TINT[state] }]}>{dotLabelFor(status)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
