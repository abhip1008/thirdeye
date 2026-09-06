# thirdeye-mobile

The review app. React Native, Expo, TypeScript. Android first.

An umpire opens this after an appeal, taps the ball in question, and watches it.
Everything else in the app exists to make sure that takes two seconds.

## Run

```bash
npm install
npx expo start        # scan the QR with Expo Go on an Android phone
```

There is no vest yet, so the app runs against `MockTransport`, which bowls on a
timer, occasionally drops a delivery, and produces the timeout and recovered
cases at a realistic rate. Settings controls the speed.

```bash
npm run typecheck
npm test
```

## Going to a development build (Phase 3)

Expo Go cannot do the native networking configuration the real vest link needs.
`app.json` is already written for a development build - plugins, permissions,
blocked permissions, package name - so the switch is:

```bash
npx expo prebuild
npx expo run:android
```

`mobile/android/` is gitignored; it is generated output.

## Layout

```
src/
├── app/         expo-router screens
├── components/  the visual vocabulary, plus the domain widgets
├── stores/      zustand: connection, clips, match, settings, pairing
├── db/          SQLite, migrations, and the only module that writes SQL
├── net/         Transport and Downloader interfaces (implementations swap in Phase 3)
├── mock/        the vest that does not exist, and the sample clip
├── privacy/     retention, storage, secrets, audit, screen guard
├── theme/       colours, spacing, type
└── types/       protocol.ts is GENERATED - see ../protocol
```

## The parts that carry the product

**`components/StatusDot.tsx` and `lib/clipStatus.ts`.** An umpire must be able to
see that a clip exists *before* announcing a review. Three states, each different
in three ways at once - hue, fill, and word - so the meaning survives colour
blindness and bright sunlight.

**`app/live.tsx`.** Four rules: no modal ever appears; the list never reorders
under a finger; tapping a row navigates instantly; the screen stays awake.

**`privacy/rules.ts`.** The retention promise as pure functions. If these are
wrong, the product's main argument is a lie.

**`app/clip/[seq].tsx`.** Frame stepping is why anyone opens it. The bundled
sample has a marker that advances a fixed distance every frame, so a step of one
is verifiable by eye.

## Design constraints

Used outdoors, in sunlight, by someone in a wide-brimmed hat, under time
pressure, with one hand. That drives everything: high contrast, 56dp minimum
touch targets, primary actions in the bottom third, no modals, no confirmation
dialogs on the review path, tabular numerals so the ball counter does not shift
under a thumb.
