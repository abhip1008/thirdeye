import { Platform, TextStyle } from 'react-native';

/**
 * Four text roles and one numeric role. That is the whole system.
 * Numerals are tabular so that a ball counter ticking from 9 to 10 does not
 * shift the layout under the umpire's thumb.
 */
const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export const type = {
  title: { fontSize: 26, fontWeight: '600', color: undefined, letterSpacing: -0.4 } as TextStyle,
  body: { fontSize: 16, fontWeight: '400' } as TextStyle,
  bodyStrong: { fontSize: 16, fontWeight: '600' } as TextStyle,
  caption: { fontSize: 13, fontWeight: '400' } as TextStyle,
  captionStrong: { fontSize: 13, fontWeight: '600', letterSpacing: 0.3 } as TextStyle,

  /** Over.ball on the live screen. Big enough to read without focusing. */
  counterHuge: {
    fontSize: 46,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  } as TextStyle,
  /** Ball numbers and durations in a list. */
  numeral: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] } as TextStyle,
  numeralSmall: { fontSize: 13, fontWeight: '500', fontVariant: ['tabular-nums'] } as TextStyle,

  mono: { fontFamily: mono, fontSize: 12 } as TextStyle,
} as const;
