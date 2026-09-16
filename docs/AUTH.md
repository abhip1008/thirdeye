# Signing in

Third Eye has an optional Auth0 sign-in. This is how to set it up, and — more
importantly — what it does and does not do.

## The constraint that shapes all of it

**During a match the phone is joined to the vest's own access point, which has
no route to the internet.** That is deliberate: it is most of why a match runs
with no network at all, and it is stated in `docs/PRIVACY.md` as a property of
the design rather than an accident of it.

Auth0 is on the internet.

So sign-in cannot be a condition of using the app, and it is not. Concretely:

- **Nothing is gated.** Pairing, recording, marking deliveries, reviewing,
  deciding and deleting all work signed out. There is no screen behind a login.
- **An expired session does not sign anyone out.** It is marked stale and the
  app carries on. An umpire whose token expired on Saturday morning still knows
  who they are on Saturday afternoon, on a network with no way to ask anybody.
- **Sign-in happens once, on ordinary Wi-Fi, beforehand.** The app remembers it.
- **The vest never learns who you are.** It authenticates the *phone*, with the
  pairing key, and has no concept of a user. See
  `docs/decisions/0006-lan-transport-security.md`.

If you find yourself wanting to gate a screen on being signed in, re-read the
first paragraph. That change would make the product stop working at a ground.

## What it is for

Today, honestly: very little. No feature turns on. It exists so that things
which genuinely need an account — a league-wide decision log, a vest issued to
whoever is umpiring that day — have something to build on, and so the shape of
the data is settled before anyone depends on it.

The sign-in screen says exactly this rather than implying an upgrade.

## Setting up a tenant

1. In the Auth0 dashboard, create a **Native** application.
2. Add this to **Allowed Callback URLs** and **Allowed Logout URLs**:

   ```
   thirdeye://auth
   ```

   In Expo Go during development the scheme is different — run the app and read
   the URI the sign-in attempt reports, then add that too.

3. Put the domain and client ID in `mobile/app.json`:

   ```json
   "extra": {
     "auth0": {
       "domain": "your-tenant.us.auth0.com",
       "clientId": "..."
     }
   }
   ```

   Leaving them empty is supported: the sign-in screen then says the build has
   no tenant configured, rather than offering a button that cannot work.

There is no client secret. A public client on a phone cannot keep one, which is
why the flow is **authorization code with PKCE** — the proof is generated per
request instead of shipped inside the app.

## What is stored, and where

| Thing | Where | Why |
|---|---|---|
| Name, email, Auth0 subject id | Platform keystore | It is the only personal data this app has ever kept, so it does not go in SQLite, where a database backup or a state dump would carry it |
| Access token | **Nowhere** | The app calls no API that would accept one. Keeping it would be holding a credential for its own sake |
| Refresh token | **Never requested** | `offline_access` is not in the scopes. A long-lived credential on a device that spends its working life on an open-ish network, in exchange for nothing, is a bad trade |

`openid profile email` are the only scopes.

**Sign out** erases the identity from the keystore immediately. It does not call
Auth0's logout endpoint, because that needs the internet and would fail on a
vest's network — and what matters is that the phone has forgotten, which it has
before the network would even be consulted.

**Delete everything** takes the identity with it. A wipe that leaves a name and
an email address behind is not what those words mean.

**Forget this vest** does *not* sign you out. They are different intentions, and
coupling them means an umpire re-pairing at a new ground is quietly signed out.

## The privacy consequence, stated plainly

Before this, the app collected nothing identifying: a match was a date and a
ground. Signing in changes that — an email address is personal data, and Auth0
is a third party that now knows an account exists and when it signed in.

That is a real change to the promises in `docs/PRIVACY.md`, which is why it is
optional, why the screen explains it before the button rather than after, and
why signing out genuinely erases rather than hides.
