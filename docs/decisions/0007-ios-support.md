# 7. iOS: free today, blocked later, and the block is not the UI

**Status:** accepted, Phase 1. Amended by
[ADR 10](0010-development-builds.md), which replaces Expo Go with real builds -
and in doing so found two permissions this decision assumed were absent.
**Relates to:** spec section 2 ("iOS - v2, Android first") and the iOS entry in
the risk register

## Context

The spec defers iOS to v2 and budgets a week for it, citing
`NEHotspotConfiguration`, `NSLocalNetworkUsageDescription` and an ATS exception.

That budget is right, and it is also easy to misread. It is a *Phase 3* cost,
not a Phase 1 cost. Phase 1 has no vest, no access point and no HTTP: it is one
React Native codebase running against a mock. There is nothing platform-specific
about a list of clips and a video scrubber.

Confusing the two leads to the wrong conclusion - that an iPhone cannot be used
to look at the product until v2 - which is false and expensive, because the
person most likely to be shown this app on a boundary is holding an iPhone.

## Decision

**Phase 1 supports both platforms.** The app bundles for iOS and runs in Expo
Go today. No separate build, no second codebase, no extra cost: it falls out of
having chosen React Native.

**Phase 3 onwards remains Android-first**, for one reason only: joining the
vest's access point.

Everything else on the iOS list is already done in this commit range - the local
network usage string, the ATS exception scoped to the vest's address and nothing
else, and file sharing disabled.

> **Correction.** This originally claimed the microphone could not be asked for
> because no usage string was declared. That was wrong: the camera plugin adds
> `NSMicrophoneUsageDescription` by default, and Expo Go was hiding it because
> the app's own Info.plist was never used. Both that string and a stray Face ID
> one are now removed explicitly, and CI asserts their absence. See
> [ADR 10](0010-development-builds.md).

## The one real blocker

On Android the app can join a specific Wi-Fi network from the pairing payload.
On iOS it cannot, without `NEHotspotConfiguration`, which needs:

- a **paid Apple Developer account** ($99/year)
- the **Hotspot Configuration entitlement**, which means a custom build
- and it therefore **does not work in Expo Go**

So the honest options for iOS in Phase 3, in the order they should be tried:

1. **Have the umpire join the vest's Wi-Fi from Settings, by hand, once.** Costs
   nothing, works in Expo Go, and is a single step at the toss rather than per
   ball. This is almost certainly the right answer for a club league.
2. **A development build with the entitlement.** Correct, automatic, and costs
   a developer account plus a build pipeline.
3. **Do not support iOS on the field.** Use a league-owned Android handset,
   which `docs/PRIVACY.md` argues for on separate grounds anyway.

Option 1 is the default until someone complains.

## Two platform differences that were privacy bugs

Both were found while checking whether iOS was viable, and both applied to code
already written:

- **iOS copies the app's Documents directory to iCloud.** Match footage would
  have synced to the umpire's personal iCloud account with nobody doing anything
  wrong, breaking the central promise that it stays on the phone. Clips now live
  under `Library/Caches` on iOS, which the operating system excludes from
  backup.
- **Android's `allowBackup` defaults to true**, which copies app-private files
  to the user's Google Drive. The same hole through a different door. Now false.

## Consequences

- iOS may evict the cache directory under storage pressure, so a row can outlive
  its file. `reconcile()` runs on hydrate and downgrades any clip whose bytes
  have gone, because a green dot over a clip that will not play is worse than a
  grey one.
- The app switcher snapshot needs an explicit call on iOS; Android gets it free
  from `FLAG_SECURE`. Both are now made.
- The ATS exception hardcodes `192.168.43.1`. When Phase 6 replaces cleartext
  with signed requests, that exception should be removed rather than left
  behind.
- Testing effort roughly doubles from Phase 3 on. That is the real ongoing cost
  of supporting both, and it is larger than the week the spec budgets.
