# 6. Transport security on the vest link

**Status:** accepted, implemented. Option 3 shipped ahead of schedule.

## Context

The phone downloads clips from `http://192.168.43.1`. You cannot obtain a real
TLS certificate for a private IP address, and Android blocks cleartext HTTP by
default.

Three options, from the spec:

1. **Plain HTTP** with a `network_security_config.xml` exception for that
   address. Fine on a point-to-point link with no router.
2. **Self-signed certificate pinned in the app.** More work, removes the
   cleartext exception, arguably overkill for a link with one client.
3. **HTTP plus an app-level shared secret.** Sign every request with an HMAC
   derived from the pairing payload.

## Decision

Option 1 got a real file across a real link without also debugging certificates.
**Option 3 now ships on top of it, and is on by default.**

It moved ahead of its original phase for one reason: the hole it closes is not
theoretical. The access point's passphrase is printed on a code taped to the
vest, in front of the players. Anyone who photographs it can join, and until
this landed, joining was the whole of the authorisation check - `GET /api/clips`
listed the footage and `GET /clips/1.mp4` handed it over. That is video of
identifiable people, mostly at amateur grounds, sometimes of children.

Option 2 is rejected: it protects against eavesdropping on a link that has one
client and no router, and does nothing about the actual adversary, which is an
unauthorised client rather than an interceptor.

## What was built

    signature = HMAC-SHA256(key, "METHOD\npath\ntimestamp\nnonce")

sent as `X-TE-Timestamp`, `X-TE-Nonce` and `X-TE-Signature`. The key is 32
random bytes, minted on the vest's first boot, kept at `/data/signing.key` with
mode `0600`, and revealed in exactly one place: the pairing payload behind
`python -m thirdeye.pairing`. It is on no route, and it is not in the startup
log - the banner prints the payload with the key redacted, because a log is
copied into bug reports.

The vest refuses a request whose timestamp is more than 300 seconds from its own
clock, and remembers the last 4096 nonces, so a signature captured off the link
cannot be replayed. Signing the method and path means a signature for
`/api/health` cannot be moved to `/clips/4.mp4`.

The WebSocket carries the same four values as query parameters, because neither
React Native nor a browser lets a client put headers on a handshake. The vest
checks them before it accepts, so an unauthorised client never gets a channel -
it never learns a clip exists, which matters more than it being unable to
download one.

Every route that reveals or changes anything is covered. `/api/health` is
deliberately not: it is how a phone finds out whether there is a vest there at
all, and it says nothing a passer-by could not learn by looking at the vest.

`THIRDEYE_REQUIRE_SIGNATURE=false` turns it off. That exists because development
needs it, and the vest logs a line in capitals when it is used.

## Consequences

- The `psk` field already existed in `PairingPayload`, in the schema and in
  `privacy/secrets.ts`, so this was an implementation rather than a protocol
  change.
- The phone builds HMAC itself, over `expo-crypto`'s SHA-256, because that
  library hashes but does not do HMAC. Two implementations of one function have
  to agree exactly and forever, so both check themselves against
  `protocol/fixtures/signing-vectors.json` - the phone in
  `src/net/__tests__/signing.test.ts`, the vest in `tests/test_security.py`.
- A phone paired before this existed has no key. It sends an unsigned request
  and the vest refuses it; the fix is to pair again. The alternative - letting
  unsigned requests through for old phones - is the same as not having built it.
- The key is a shared secret, not a per-phone identity. Two phones paired to one
  vest are indistinguishable to it. That is the right model for a vest and one
  umpire's phone, and it is not the right model for a fleet; a fleet wants a key
  per phone and a revocation list, which is a different piece of work.
