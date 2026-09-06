/**
 * A 4pt grid. Only these values are used anywhere in the app; if a layout
 * seems to need something in between, the layout is wrong.
 */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/**
 * Minimum touch target. The spec says 56dp: one hand, possibly gloved,
 * possibly while someone is shouting. Nothing tappable goes below this.
 */
export const TOUCH_MIN = 56;

/** A clip row. Taller than the touch minimum because it is the main target. */
export const ROW_HEIGHT = 68;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;
