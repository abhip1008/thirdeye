import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, StyleSheet, Text, View } from 'react-native';

import { clock } from '@/lib/format';
import { colors } from '@/theme/colors';
import { space } from '@/theme/spacing';
import { type } from '@/theme/typography';

/**
 * Frame-precise scrub bar.
 *
 * The track is 44dp tall even though the drawn line is 4dp, because a thumb
 * lands where it lands. Dragging reports continuously so the frame under the
 * finger is the frame on screen; there is no commit-on-release step to be
 * surprised by.
 *
 * The gesture reads `locationX`, which is already relative to the track, so
 * there is no page-offset measurement to get wrong when the layout changes.
 */
export function Scrubber({
  position,
  duration,
  fps,
  onScrub,
  onScrubStart,
  onScrubEnd,
}: {
  position: number;
  duration: number;
  fps: number;
  onScrub: (seconds: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
}) {
  const [width, setWidth] = useState(0);

  /* The responder is created once and reads live values through refs, so a
     re-render mid-drag cannot swap the handlers out from under the gesture. */
  const widthRef = useRef(0);
  const durationRef = useRef(duration);
  const callbacks = useRef({ onScrub, onScrubStart, onScrubEnd });

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);
  useEffect(() => {
    callbacks.current = { onScrub, onScrubStart, onScrubEnd };
  }, [onScrub, onScrubStart, onScrubEnd]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    widthRef.current = w;
    setWidth(w);
  }, []);

  const responder = useMemo(() => {
    const seekFromX = (x: number) => {
      const w = widthRef.current;
      if (w <= 0) return;
      const fraction = Math.min(1, Math.max(0, x / w));
      callbacks.current.onScrub(fraction * durationRef.current);
    };

    /* The lint rule cannot see that these closures only run from the gesture
       system, never during render, so it flags the refs they capture. The
       "latest ref" pattern is exactly right here: the handlers must be stable
       for the life of a drag while still reading current values. */
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        callbacks.current.onScrubStart();
        seekFromX(e.nativeEvent.locationX);
      },
      onPanResponderMove: (e) => seekFromX(e.nativeEvent.locationX),
      onPanResponderRelease: () => callbacks.current.onScrubEnd(),
      onPanResponderTerminate: () => callbacks.current.onScrubEnd(),
    });
  }, []);

  const fraction = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const frame = Math.round(position * fps);
  const totalFrames = Math.round(duration * fps);

  return (
    <View style={s.wrap}>
      <View
        style={s.touchArea}
        onLayout={onLayout}
        {...responder.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel={`Position ${clock(position)} of ${clock(duration)}`}
      >
        <View style={s.track}>
          <View style={[s.fill, { width: Math.max(0, fraction * width) }]} />
        </View>
        <View style={[s.thumb, { left: Math.max(0, fraction * width - 11) }]} />
      </View>

      <View style={s.readout}>
        <Text style={[type.numeralSmall, { color: colors.textMuted }]}>{clock(position)}</Text>
        <Text style={[type.numeralSmall, { color: colors.textMuted }]}>
          frame {frame} / {totalFrames}
        </Text>
        <Text style={[type.numeralSmall, { color: colors.textMuted }]}>{clock(duration)}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: space.xl },
  touchArea: { height: 44, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.accent },
  thumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent,
    borderWidth: 3,
    borderColor: colors.bg,
  },
  readout: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xs },
});
