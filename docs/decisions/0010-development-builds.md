# 10. Development builds, not Expo Go

**Status:** accepted
**Amends:** [ADR 7](0007-ios-support.md), which chose Expo Go for Phase 1

## Context

Phase 1 ran in Expo Go: scan a QR code and the app is on the phone, both
platforms, no build. It is the fastest device-testing loop that exists.

It is also not the app.

In Expo Go the JavaScript runs inside **Expo Go's** container, with Expo Go's
`Info.plist`, Expo Go's entitlements and Expo Go's permissions. Which means none
of this was ever active:

- the blocked microphone, location and media-library permissions
- `allowBackup: false`, and the iCloud-exclusion fix for clip storage
- the App Transport Security exception scoped to the vest
- screenshot blocking and the app-switcher blur
- the app-private container path the retention promise depends on

**The entire privacy layer was untestable**, which is a poor position for the
part of the system the whole product argument rests on.

## Decision

Move to `expo prebuild` and real native builds. Open the generated Xcode project
and run it on a device; use Android Studio or Gradle for the other half.

This is not leaving Expo. `npx expo prebuild` generates both native projects
from `app.json`; Xcode and Android Studio then build them like any hand-written
native app, and Metro still serves JavaScript so the fast reload loop survives.

The native directories stay **generated and gitignored**. `app.json` remains the
source of truth, so the configuration is reviewable in a diff rather than buried
in a 10,000-file Xcode project. The trade is that changes made inside Xcode are
wiped by the next prebuild; native changes go through `app.json` or a config
plugin instead.

## Consequences

- The privacy layer becomes verifiable for the first time. That alone justifies
  the change.
- Testing effort roughly doubles: each platform is now its own build. The
  mitigation is that only four lines in the entire app are platform-specific, so
  a bug found on one is almost always fixed on both.
- CI now exports an Android bundle on every push, so the Android build cannot
  quietly rot during long stretches of iPhone-only development.
- A free Apple ID is enough to install on a device, with a seven-day expiry. The
  paid account is only needed for the Wi-Fi-join entitlement in Phase 3, and
  [ADR 7](0007-ios-support.md) has a workaround for that.
- Expo Go still works and is still the fastest way to show someone the app. It
  is now a demo tool rather than the development target.
