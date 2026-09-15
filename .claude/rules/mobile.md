---
paths:
  - "mobile/**"
---

# Mobile rules

React Native, Expo, TypeScript. Strict mode with unused locals and params on.
`npm run typecheck` is expected to report zero errors.

## The live screen

`src/app/live.tsx` is where the umpire spends the match. Four rules hold it
together and none are negotiable:

- No modal ever appears on this screen.
- The list never reorders under a finger.
- Tapping a row navigates instantly.
- The screen stays awake.

## Design constraints

Used outdoors, in sunlight, under a wide-brimmed hat, one-handed, under time
pressure. High contrast, 56dp minimum touch targets, primary actions in the
bottom third, tabular numerals so counters do not shift under a thumb.

The status dot in `src/components/StatusDot.tsx` differs in three ways at once,
hue and fill and word, so it survives colour blindness and direct sunlight.
Do not collapse it to colour alone.

## Structure

- `src/db/` is the only module that writes SQL.
- `src/net/` holds the `Transport` and `Downloader` interfaces. Nothing above
  them knows whether the mock or the real implementation is live. Do not add
  `isMock` branches to screens or stores.
- `src/types/protocol.ts` is generated. See the protocol rules.
- `src/privacy/rules.ts` is pure functions, no database, no filesystem, no
  network. Keep it that way so it stays testable.

## Testing

Rendering is deliberately not snapshot-tested. A component tree snapshot does
not tell you whether an umpire can read the screen in sunlight. Test the
retention rules, the status mapping, log redaction, the protocol contract, and
the mock vest's behaviour under fake timers.
