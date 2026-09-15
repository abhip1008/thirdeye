# Third Eye

Umpire-worn replay system for club cricket. One repository, four packages:
`protocol/`, `mobile/`, `vest/`, `cloud/`.

`README.md` is the product and how to run it. `INFO.md` is the build notes.
`HANDOFF.md` is the current working state. Read those rather than restating
them here.

## Commands

From the repo root:

```bash
npm run protocol          # regenerate TypeScript and Python from the schema
npm run protocol:check    # fails if either is stale; runs in CI
```

From `mobile/`:

```bash
npm run typecheck         # tsc --noEmit, strict, unused locals and params on
npm run lint
npm test
npx expo run:ios --device
npx expo run:android
```

From `vest/`:

```bash
./.venv/bin/python -m pytest
./.venv/bin/python scripts/smoke_test.py
./.venv/bin/uvicorn thirdeye.main:app --host 0.0.0.0 --port 8000
```

## Non-negotiables

- `protocol/schema/protocol.v1.json` is the only definition of the wire format.
  Never hand-edit `mobile/src/types/protocol.ts` or `vest/thirdeye/protocol.py`.
  Both carry an `@generated` header and `protocol:check` will fail.
- Decisions that deviate from the spec get a numbered ADR in `docs/decisions/`,
  written in the same change, not afterwards.
- Retention is the product's main claim. Anything touching
  `mobile/src/privacy/` needs tests alongside it.
- Do not add runtime permissions to the mobile app. CI asserts the permission
  surface and will fail.
- Never commit a signing key, and never commit anything under `footage/`.

## Working agreement

- `HANDOFF.md` carries state between sessions, including sessions in a
  different tool. Read it at the start of work and update the affected section
  at the end of any session that changed the state of a subsystem.
- The camera is the last fake removed, not the first. Anything that only works
  with hardware attached gets an interface seam and a mock, per
  `docs/decisions/0004-mock-first-with-interface-seams.md`.
- Prefer editing an existing doc over adding a new one. This repo is already
  heavily documented and duplicate prose goes stale in one direction.
