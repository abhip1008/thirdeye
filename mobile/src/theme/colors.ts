/**
 * One palette, tuned for a phone held at arm's length in direct sunlight by
 * someone under time pressure. Everything here is high contrast on purpose.
 * There are no mid-greys used for text and no decorative colour.
 *
 * Rule that overrides taste: colour never carries meaning on its own. Every
 * status that uses a hue also uses a shape and a word. Red-green colour
 * blindness affects roughly 8% of men and this ships to a cricket league.
 */
export const colors = {
  bg: '#FFFFFF',
  surface: '#F4F5F7',
  surfaceSunk: '#EAECEF',
  border: '#D6D9DE',
  /** Hairline between list rows. Lighter than a border you are meant to notice. */
  rule: '#E7E9ED',
  borderStrong: '#B3B9C2',

  text: '#111418',
  textMuted: '#5A6270',
  textOnDark: '#FFFFFF',

  /** Clip is on the phone, verified, will play instantly. */
  ready: '#1B8A4B',
  /** Clip is announced or in flight. Tappable, but shows progress. */
  pending: '#C77700',
  /** Clip failed or rolled out of the ring. Not tappable. */
  missing: '#8A9099',

  accent: '#1F4FD8',
  accentSunk: '#173CA6',
  danger: '#C2261C',
  recording: '#C2261C',

  scrim: 'rgba(17, 20, 24, 0.06)',
  black: '#000000',
} as const;

export type ColorName = keyof typeof colors;
