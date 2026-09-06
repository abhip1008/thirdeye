# 5. Pinning a clip sets an expiry, it does not remove one

**Status:** accepted, Phase 1

## Context

The retention promise - twelve balls, then deleted - is the answer to the
privacy objection, the storage cost and the "are you filming me" conversation
all at once. It is the product's best argument.

In most systems, marking something important means keeping it forever. The
moment that is true here, the promise stops holding for exactly the clips people
care about most: the wicket, the appeal, the incident.

## Decision

`clips.purge_after` is an explicit unix timestamp on every retained clip.
Pinning sets it to `now + pinRetentionDays`. It is never null for a pinned clip.

Rule one of the sweep, ahead of everything else: a clip past `purge_after` is
deleted, pinned or not, reviewed or not.

## Consequences

- Retention is a property of a row rather than a rule someone has to remember to
  apply, and a row that outlives its date is deleted by any sweep that sees it.
- "Kept until 13 September" can be shown to a player, which is a much better
  answer than "kept".
- The league still has to decide what happens when a clip is wanted as
  disciplinary evidence. See `docs/PRIVACY.md` section 8. The default is that it
  expires, and overriding that should be a deliberate act.
