import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { colors } from '@/theme/colors';

/**
 * Two reference lines the umpire drags onto the picture.
 *
 * A vertical line aligned to the stumps answers "was it outside the line".
 * A horizontal line at bail height answers "was it above the stumps". Neither
 * is measurement and the app never claims they are; they are the digital
 * version of holding a finger against the screen, which is what an umpire does
 * with a replay anyway.
 *
 * Positions are per clip, not global. Two deliveries are filmed from two
 * slightly different chest angles and a line carried over from the last one is
 * worse than no line at all.
 */
export interface OverlayState {
  showStumpLine: boolean;
  showBailLine: boolean;
  /** Fractions of width/height, so they survive a rotation or a resize. */
  stumpX: number;
  bailY: number;
}

export const defaultOverlay: OverlayState = {
  showStumpLine: false,
  showBailLine: false,
  stumpX: 0.62,
  bailY: 0.55,
};

export function OverlayCanvas({
  state,
  onChange,
}: {
  state: OverlayState;
  onChange: (next: OverlayState) => void;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  /* Created once, reading live values through refs. Recreating a responder
     while a finger is down loses the gesture, and a drag updates state on
     every move, so the handlers must not be rebuilt on each of them. */
  const live = useRef({ state, size, onChange });
  useEffect(() => {
    live.current = { state, size, onChange };
  }, [state, size, onChange]);

  const vertical = useMemo(
    () =>
      // Gesture-only closures; see the note in Scrubber.tsx.
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onStartShouldSetPanResponder: () => live.current.state.showStumpLine,
        onMoveShouldSetPanResponder: () => live.current.state.showStumpLine,
        onPanResponderMove: (e) => {
          const { width } = live.current.size;
          if (!width) return;
          const x = Math.min(1, Math.max(0, e.nativeEvent.locationX / width));
          live.current.onChange({ ...live.current.state, stumpX: x });
        },
      }),
    []
  );

  const horizontal = useMemo(
    () =>
      // Gesture-only closures; see the note in Scrubber.tsx.
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onStartShouldSetPanResponder: () => live.current.state.showBailLine,
        onMoveShouldSetPanResponder: () => live.current.state.showBailLine,
        onPanResponderMove: (e) => {
          const { height } = live.current.size;
          if (!height) return;
          const y = Math.min(1, Math.max(0, e.nativeEvent.locationY / height));
          live.current.onChange({ ...live.current.state, bailY: y });
        },
      }),
    []
  );

  const { width, height } = size;
  const anyVisible = state.showStumpLine || state.showBailLine;

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={anyVisible ? 'auto' : 'none'}
      onLayout={(e) => setSize(e.nativeEvent.layout)}
    >
      {width > 0 && (
        <Svg width={width} height={height} pointerEvents="none">
          {state.showStumpLine && (
            <Line
              x1={state.stumpX * width}
              y1={0}
              x2={state.stumpX * width}
              y2={height}
              stroke={colors.pending}
              strokeWidth={2}
            />
          )}
          {state.showBailLine && (
            <Line
              x1={0}
              y1={state.bailY * height}
              x2={width}
              y2={state.bailY * height}
              stroke={colors.accent}
              strokeWidth={2}
            />
          )}
        </Svg>
      )}

      {/* Fat invisible grab handles. The drawn line is 2px; the target is 48. */}
      {state.showStumpLine && width > 0 && (
        <View
          {...vertical.panHandlers}
          style={[s.grabV, { left: state.stumpX * width - 24, height }]}
        />
      )}
      {state.showBailLine && height > 0 && (
        <View
          {...horizontal.panHandlers}
          style={[s.grabH, { top: state.bailY * height - 24, width }]}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  grabV: { position: 'absolute', width: 48, top: 0 },
  grabH: { position: 'absolute', height: 48, left: 0 },
});
