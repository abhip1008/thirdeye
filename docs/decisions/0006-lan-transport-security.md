# 6. Transport security on the vest link

**Status:** proposed. Phase 3 ships option 1, Phase 6 must ship option 3.

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

Phase 3 ships option 1, to get a real file across a real link without also
debugging certificates.

**Phase 6 must ship option 3 before any real match.** Without it, every phone
that joins the access point can enumerate and download clips, and the passphrase
is on a QR code that every player standing near the umpire can photograph. That
is the largest hole in `docs/THREAT_MODEL.md`.

Option 2 is rejected: it protects against eavesdropping on a link that has one
client and no router, and does nothing about the actual adversary, which is an
unauthorised client rather than an interceptor.

## Consequences

- The `psk` field already exists in `PairingPayload` and in the schema, and
  `privacy/secrets.ts` already stores and clears it. Phase 6 is an
  implementation, not a protocol change.
- Until Phase 6 lands, the access point is the trust boundary and the
  documentation says so rather than implying otherwise.
