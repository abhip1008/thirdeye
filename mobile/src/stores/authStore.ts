import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { create } from 'zustand';

import { auth0Config, auth0Configured, auth0Issuer } from '@/auth/config';
import { claimsOf, isStale, type Identity } from '@/auth/identity';
import { log } from '@/lib/log';
import { audit } from '@/privacy/audit';
import { secrets } from '@/privacy/secrets';

/**
 * Who is using this phone, when anyone has said.
 *
 * The hard requirement, and the one that shapes everything here: **signing in
 * must never be a condition of umpiring.** During a match the phone is joined to
 * the vest's own access point, which has no route to the internet by design.
 * Auth0 lives on the internet. An app that demanded a fresh token at the toss
 * would lock an umpire out at precisely the moment they cannot do anything about
 * it, and `docs/THREAT_MODEL.md` already argues against making them type so much
 * as a PIN during an appeal.
 *
 * So the rules are:
 *
 * - Sign-in happens once, while there is internet, and is remembered.
 * - An expired token does **not** sign anyone out. The identity is still known;
 *   it is simply stale, and says so.
 * - Every screen works signed out. Nothing is gated.
 * - Nothing about the identity ever reaches the vest. The vest authenticates
 *   the *phone*, with the pairing key, and has no idea who is holding it.
 *
 * What is stored is a name, an email address and Auth0's subject id. That is the
 * only personal data this application has ever kept, which is why it goes to the
 * keystore rather than the database, and why "Sign out" really does erase it.
 */

WebBrowser.maybeCompleteAuthSession();

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthStore {
  status: AuthStatus;
  identity: Identity | null;
  /** Set when a sign-in attempt failed, for the screen to show. */
  error: string | null;
  busy: boolean;

  load: () => Promise<void>;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
  /** True when the session is past its expiry: known, but no longer fresh. */
  isStale: () => boolean;
}

/**
 * Where Auth0 sends the browser back to.
 *
 * Exported because it has to be typed into the Auth0 dashboard, character for
 * character, and a mismatch is the single most common way this fails to work -
 * with an error message that says "Callback URL mismatch" and not what the app
 * actually asked for. The sign-in screen shows this value so there is nothing
 * to guess at.
 */
export const redirectUri = AuthSession.makeRedirectUri({ scheme: 'thirdeye', path: 'auth' });

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

export const useAuth = create<AuthStore>((set, get) => ({
  status: 'loading',
  identity: null,
  error: null,
  busy: false,

  /** Called once at boot. Reads the keystore; touches no network. */
  load: async () => {
    try {
      const stored = await secrets.getIdentity();
      if (!stored) {
        set({ status: 'signedOut', identity: null });
        return;
      }
      const identity = JSON.parse(stored) as Identity;
      // Deliberately not checking the expiry here. A stale identity is still an
      // identity, and a vest's access point cannot renew it.
      set({ status: 'signedIn', identity });
      log.info('auth', `signed in as ${identity.email ?? identity.sub}`);
    } catch (e) {
      log.warn('auth', 'could not read the stored identity', { error: String(e) });
      set({ status: 'signedOut', identity: null });
    }
  },

  signIn: async () => {
    if (!auth0Configured) {
      set({ error: 'This build has no Auth0 tenant configured.' });
      return false;
    }
    set({ busy: true, error: null });
    try {
      const discovery = await AuthSession.fetchDiscoveryAsync(auth0Issuer);

      // PKCE, which AuthSession does by default and which matters here: a
      // public client on a phone cannot keep a client secret, so the proof has
      // to be per-request rather than baked into the app.
      const request = new AuthSession.AuthRequest({
        clientId: auth0Config.clientId,
        redirectUri,
        responseType: AuthSession.ResponseType.Code,
        scopes: ['openid', 'profile', 'email'],
        usePKCE: true,
        // No offline_access, so no refresh token. There is nothing to refresh
        // for: the app calls no cloud API. Asking for one would mean holding a
        // long-lived credential on a device that spends its working life on an
        // open-ish network, in exchange for nothing.
        extraParams: { audience: `https://${auth0Config.domain}/userinfo` },
      });

      const result = await request.promptAsync(discovery);
      if (result.type !== 'success' || !result.params.code) {
        if (result.type === 'error') {
          set({ error: result.params.error_description ?? 'Sign-in failed.' });
        }
        return false;
      }

      const tokens = await AuthSession.exchangeCodeAsync(
        {
          clientId: auth0Config.clientId,
          code: result.params.code,
          redirectUri,
          extraParams: { code_verifier: request.codeVerifier ?? '' },
        },
        discovery
      );

      const payload = tokens.idToken ? claimsOf(tokens.idToken) : null;
      if (!payload?.sub) {
        set({ error: 'Auth0 did not return an identity.' });
        return false;
      }

      const identity: Identity = {
        sub: String(payload.sub),
        email: asString(payload.email),
        name: asString(payload.name) ?? asString(payload.nickname),
        expiresAt:
          typeof payload.exp === 'number' ? payload.exp : Date.now() / 1000 + 24 * 3600,
        signedInAt: Date.now() / 1000,
      };

      // The identity is kept; the tokens are not. Nothing in this app calls an
      // API that would accept one, so holding an access token would be keeping
      // a credential for its own sake.
      await secrets.setIdentity(JSON.stringify(identity));
      await audit('auth.signed_in', null, { sub: identity.sub });
      set({ status: 'signedIn', identity, error: null });
      log.info('auth', 'signed in');
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Almost always "there is no internet", which on a vest's access point is
      // the normal state of affairs rather than a fault.
      log.warn('auth', 'sign-in failed', { error: message });
      set({ error: 'Could not reach the sign-in service. Check you have internet.' });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  signOut: async () => {
    const identity = get().identity;
    await secrets.setIdentity(null);
    await audit('auth.signed_out', null, { sub: identity?.sub ?? null });
    set({ status: 'signedOut', identity: null, error: null });
    log.info('auth', 'signed out');
    // No call to Auth0's logout endpoint: it needs the internet, it would fail
    // on a vest's network, and what matters here is that the phone has forgotten
    // - which it has, before this line.
  },

  isStale: () => isStale(get().identity),
}));

export type { Identity };
