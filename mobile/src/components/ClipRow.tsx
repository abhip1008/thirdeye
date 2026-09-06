import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { megabytes, overBall, seconds } from '@/lib/format';
import { colors } from '@/theme/colors';
import { ROW_HEIGHT, radius, space } from '@/theme/spacing';
import { type } from '@/theme/typography';
import type { Clip } from '@/types/clip';

import { StatusDot, dotLabelFor, dotStateFor } from './StatusDot';

/**
 * One delivery in the list.
 *
 * The whole row is the tap target and it never moves once drawn. Badges use a
 * word, not a glyph, because an umpire is not going to learn an icon language
 * between overs and a wrong guess about what a symbol meant is worse than the
 * extra millimetre of text.
 */

function badges(clip: Clip): string[] {
  const out: string[] = [];
  if (clip.pinned) out.push('Kept');
  if (clip.reviewed) out.push('Reviewed');
  if (clip.closed_by === 'timeout') out.push('Timed out');
  if (clip.closed_by === 'recovered') out.push('Recovered');
  if (clip.closed_by === 'manual') out.push('Grabbed');
  if (!clip.legal) out.push('Not a legal ball');
  return out;
}

function detail(clip: Clip): string {
  if (clip.status === 'downloading') {
    const pct = clip.bytes ? Math.round((clip.bytesLocal / clip.bytes) * 100) : 0;
    return `${pct}% of ${megabytes(clip.bytes)}`;
  }
  if (clip.status === 'verifying') return 'Checking it is intact';
  if (clip.status === 'announced') return 'Waiting for the vest';
  if (clip.status === 'failed') return clip.lastError ?? 'Did not arrive';
  if (clip.status === 'expired') return 'Rolled out of the buffer';
  return seconds(clip.duration_s);
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
  const marks = badges(clip);

  return (
    <Pressable
      onPress={tappable ? onPress : undefined}
      onLongPress={onLongPress}
      delayLongPress={400}
      disabled={!tappable}
      accessibilityRole="button"
      accessibilityLabel={`Ball ${clip.seq}, over ${overBall(clip.over, clip.ball_in_over)}, ${dotLabelFor(clip.status)}. ${marks.join(', ')}`}
      style={({ pressed }) => [s.row, pressed && s.pressed]}
    >
      <View style={s.dot}>
        <StatusDot status={clip.status} size={16} />
      </View>

      <View style={s.main}>
        <View style={s.titleRow}>
          <Text style={[type.numeral, { color: tappable ? colors.text : colors.textMuted }]}>
            Ball {clip.seq}
          </Text>
          <Text style={[type.numeralSmall, { color: colors.textMuted }]}>
            {overBall(clip.over, clip.ball_in_over)}
          </Text>
        </View>
        <Text style={[type.caption, { color: colors.textMuted }]} numberOfLines={1}>
          {detail(clip)}
        </Text>
      </View>

      {marks.length > 0 && (
        <View style={s.badges}>
          {marks.slice(0, 2).map((m) => (
            <View key={m} style={s.badge}>
              <Text style={[type.caption, s.badgeText]}>{m}</Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
});

const s = StyleSheet.create({
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: { backgroundColor: colors.surface },
  dot: { width: 20, alignItems: 'center' },
  main: { flex: 1, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  badges: { alignItems: 'flex-end', gap: 4 },
  badge: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
  },
  badgeText: { color: colors.textMuted },
});
