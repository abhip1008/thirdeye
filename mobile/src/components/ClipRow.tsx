import { memo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { dotLabelFor, dotStateFor } from '@/lib/clipStatus';
import { megabytes, seconds } from '@/lib/format';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/spacing';
import { type } from '@/theme/typography';
import type { Clip } from '@/types/clip';

import { StatusDot } from './StatusDot';

/**
 * One delivery in the list: a still from the ball, its number, and its state.
 *
 * The picture is not decoration. A column of identical text is slow to scan
 * under pressure, and a frame from the delivery is the fastest way to find the
 * one you mean. It also happens to be independent evidence: the dot says the
 * bytes verified, the picture says they decode.
 *
 * The whole row is the tap target and it never moves once drawn.
 */

const THUMB_W = 86;
const THUMB_H = 54;   // 16:10, matching the camera

function detail(clip: Clip): string | null {
  if (clip.status === 'downloading') {
    const pct = clip.bytes ? Math.round((clip.bytesLocal / clip.bytes) * 100) : 0;
    return `${pct}% of ${megabytes(clip.bytes)}`;
  }
  if (clip.status === 'failed') return clip.lastError ?? 'Did not arrive';
  if (clip.status === 'expired') return 'Deleted';
  if (clip.pinned) return 'Kept';
  if (clip.closed_by === 'timeout') return 'Ran on to 40 seconds';
  if (clip.closed_by === 'recovered') return 'Start was missed';
  if (clip.closed_by === 'manual') return 'Grabbed afterwards';
  return null;
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
      <View style={s.thumb}>
        {/* Never for a clip that cannot be played. A picture next to "Not here"
            contradicts the words beside it, and between a thumbnail and the
            status dot the dot is the one that has to be believed. */}
        {clip.thumbPath && tappable ? (
          <Image
            source={{ uri: clip.thumbPath }}
            style={s.image}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        ) : (
          // No picture yet, or never. The box stays the same size either way so
          // rows do not change height as thumbnails arrive underneath a finger.
          <View style={[s.image, s.imageEmpty]}>
            <StatusDot status={clip.status} size={14} />
          </View>
        )}
        {clip.thumbPath && clip.status === 'ready' && (
          <Text style={s.duration}>{seconds(clip.duration_s)}</Text>
        )}
      </View>

      <View style={s.main}>
        <View style={s.head}>
          <Text style={[type.numeral, { color: tappable ? colors.text : colors.textMuted }]}>
            Ball {clip.seq}
          </Text>
          <StatusDot status={clip.status} size={11} />
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
    </Pressable>
  );
});

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
  },
  pressed: { backgroundColor: colors.surface },

  thumb: { width: THUMB_W, height: THUMB_H },
  image: {
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSunk,
  },
  imageEmpty: { alignItems: 'center', justifyContent: 'center' },
  duration: {
    position: 'absolute',
    right: 3,
    bottom: 3,
    color: colors.textOnDark,
    backgroundColor: 'rgba(0,0,0,0.68)',
    fontSize: 10,
    fontVariant: ['tabular-nums'],
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
  },

  main: { flex: 1, gap: 3 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
