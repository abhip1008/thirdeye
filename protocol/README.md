# @thirdeye/protocol

The wire format, and the only definition of it.

`schema/protocol.v1.json` describes every message that crosses between the vest,
the phone and the cloud. Everything else is generated from it:

| Generated file | Consumed by |
|---|---|
| `../mobile/src/types/protocol.ts` | the phone |
| `../vest/thirdeye/protocol.py` | the vest, as Pydantic models |

Both are committed so that neither package needs a build step to be readable,
and `npm run protocol:check` at the repo root fails if either is stale.

## Changing the protocol

1. Edit `schema/protocol.v1.json`.
2. Run `npm run protocol` from the repo root.
3. Update `fixtures/protocol.v1.json` if you added a message.
4. Run both contract tests. They read the same fixture:
   - `mobile/src/types/__tests__/protocol.contract.test.ts`
   - `vest/tests/test_protocol_contract.py`

Do not hand-edit the generated files. They carry an `@generated` header and the
check will fail.

## Compatibility rules

These three make a mixed fleet of vests and phones survivable, which matters as
soon as a league has more than one of each:

- Every message carries `v`. **Unknown message types are ignored, not errors**,
  so either side can be upgraded independently.
- `hello` carries the vest's `protocol` number. A phone that sees a higher
  number flags it rather than misparsing.
- `hello` carries `ring_size`. The phone mirrors the vest's retention window
  instead of hardcoding twelve.

Adding an optional field is backwards compatible. Adding a required field, or
removing or renaming anything, is a new protocol version and a new schema file.

## The generator

`scripts/generate.mjs`, zero dependencies. It understands the subset of JSON
Schema this protocol uses: objects, string enums, `const` discriminators,
`$ref`, arrays, nullable type unions, and `oneOf` with `x-discriminator`.

Extend it rather than reaching for something outside that subset. It has to run
in CI, on a laptop with no network and on the ROCK, and it must never be the
reason a build fails.
