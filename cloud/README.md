# thirdeye-cloud

Optional. Deferred to Phase 8.

Pinned clips and the decision log reach a server after the match, eventually.
**Nothing on match day may depend on this.** If the entire cloud is down a match
runs identically, and the design should stay that way.

## Status

Phase 1: this README and a `pyproject.toml`. Deliberately nothing else.

## Before writing a line of it

Two questions have to be answered first, and they are policy questions, not
engineering ones:

1. **How long is a pinned clip retained on a server, and who can delete it?**
   A wicket clip could be pulled into a disciplinary hearing. Decide the answer
   before someone asks for footage, not after.
2. **Who is the controller of that footage?** The league, or the person who
   built the vest? The answer changes who has to respond when a player asks for
   their data to be removed.

See `../docs/PRIVACY.md`.
