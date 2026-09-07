import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { dotLabelFor, dotStateFor } from '@/lib/clipStatus';
import { megabytes, seconds } from '@/lib/format';
import { colors } from '@/theme/colors';
import { ROW_HEIGHT, space } from '@/theme/spacing';
import { type } from '@/theme/typography';
import type { Clip } from '@/types/clip';

import { StatusDot } from './StatusDot';

/**
 * One delivery in the list.
 *
 * A ball number, a word for its state, and how long it ran. Nothing else
 * competes for attention: the list is scanned, not read, and every extra column
 * is something the eye has to skip on the way to the dot.
 *
 * The whole row is the tap target and it never moves once drawn.
 */

function note(clip: Clip): string | null {
  if (clip.pinned) return 'Kept';
  if (clip.closed_by === 'timeout') return 'Ran on to 40 seconds';
  if (clip.closed_by === 'recovered') return 'Start was missed';
  if (clip.closed_by === 'manual') return 'Grabbed afterwards';
  return null;
}

function detail(clip: Clip): string | null {
  if (clip.status === 'downloading') {
    const pct = clip.bytes ? Math.round((clip.bytesLocal / clip.bytes) * 100) : 0;
    return `${pct}% of ${megabytes(clip.bytes)}`;
  }
  if (clip.status === 'failed') return clip.lastError ?? 'Did not arrive';
  if (clip.status === 'expired') return 'Deleted';
  return note(clip);
}

export const ClipRow = memo(function ClipRow({
  clip,
  onPress,
  onLongPress,
}: {
  clip: Clip;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const state = dotStateFor(clip.status);
  const tappable = state !== 'missing';
  const sub = detail(clip);

  return (
    <Pressable
      onPress={tappable ? onPress : undefined}
      onLongPress={onLongPress}
      delayLongPress={400}
      disabled={!tappable}
      accessibilityRole="button"
      accessibilityLabel={`Ball ${clip.seq}, ${dotLabelFor(clip.status)}${sub ? `, ${sub}` : ''}`}
      style={({ pressed }) => [s.row, pressed && s.pressed]}
    >
      <StatusDot status={clip.status} size={16} />

      <View style={s.main}>
        <View style={s.head}>
          <Text style={[type.numeral, { color: tappable ? colors.text : colors.textMuted }]}>
            Ball {clip.seq}
          </Text>
          <Text style={[type.caption, { color: colors.textMuted }]}>
            {dotLabelFor(clip.status)}
          </Text>
        </View>
        {sub ? (
          <Text style={[type.caption, { color: colors.textMuted }]} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>

      {clip.status === 'ready' && (
        <Text style={[type.numeralSmall, { color: colors.textMuted }]}>
          {seconds(clip.duration_s)}
        </Text>
      )}
    </Pressable>
  );
});

const s = StyleSheet.create({
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule ?? colors.border,
  },
  pressed: { backgroundColor: colors.surface },
  main: { flex: 1, gap: 2 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
});
