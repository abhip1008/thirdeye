# 1. Monorepo with a generated protocol

**Status:** accepted, Phase 1
**Supersedes:** spec section 6, which proposes four separate repositories

## Context

The vest describes the wire format in Pydantic and the phone describes the same
format in TypeScript. The spec offers two ways to keep them honest: a duplicated
JSON fixture with a test on each side, or generating TypeScript from FastAPI's
OpenAPI output.

Both work, and both leave a window in which one repository has been changed and
the other has not.

## Decision

One repository, five packages: `protocol`, `mobile`, `vest`, `remote`, `cloud`.

`protocol/schema/protocol.v1.json` is the only definition of the wire format.
`node protocol/scripts/generate.mjs` writes `mobile/src/types/protocol.ts` and
`vest/thirdeye/protocol.py`. Both generated files are committed, and
`npm run protocol:check` fails if either is stale.

A golden fixture, `protocol/fixtures/protocol.v1.json`, is parsed by a test on
each side, including three shapes that must be rejected.

The generator has no dependencies. It runs in CI, on a laptop with no network,
and on the ROCK, and it must never be the reason a build fails.

## Consequences

- A protocol change that only one side was told about is a build error rather
  than a match-day failure.
- One PR touches both sides of a contract change, which is what review wants.
- The ESP32 firmware loses its own release cycle. Accepted: it is one file today
  and it can be split out with `git subtree` if it ever earns independence.
- The generator understands a subset of JSON Schema. Extending it is the
  supported route; hand-editing the output is not.
