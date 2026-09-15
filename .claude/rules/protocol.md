---
paths:
  - "protocol/**"
  - "mobile/src/types/protocol.ts"
  - "vest/thirdeye/protocol.py"
---

# Protocol rules

`protocol/schema/protocol.v1.json` is the source of truth. Everything else is
generated from it.

## Changing a message

1. Edit `protocol/schema/protocol.v1.json`
2. Run `npm run protocol` from the repo root
3. Update `protocol/fixtures/protocol.v1.json` if a message was added
4. Run both contract tests; they read the same fixture

Never hand-edit the generated files. They carry an `@generated` header and
`npm run protocol:check` fails in CI when they are stale.

## Compatibility

- Every message carries `v`.
- Unknown message types are ignored rather than treated as errors, so either
  side can be upgraded independently. Do not change this to throw.
- `hello` carries the vest's protocol number and ring size. The phone mirrors
  both rather than hardcoding them. Keep it that way.
