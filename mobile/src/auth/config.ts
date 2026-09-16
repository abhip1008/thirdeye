import Constants from 'expo-constants';

/**
 * Where the Auth0 tenant is, if there is one.
 *
 * Read from `app.json` → `expo.extra.auth0` rather than baked in, because a
 * tenant is per-deployment: a league running its own Third Eye has its own, and
 * nobody should have to edit TypeScript to point at it.
 *
 * Both values empty is a supported state, not a misconfiguration. The app works
 * without an identity provider - see `authStore` for why that has to be true -
 * and when these are blank the sign-in screen says so plainly instead of
 * offering a button that cannot work.
 */
interface Auth0Config {
  domain: string;
  clientId: string;
}

const raw = (Constants.expoConfig?.extra?.auth0 ?? {}) as Partial<Auth0Config>;

export const auth0Config: Auth0Config = {
  domain: (raw.domain ?? '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, ''),
  clientId: (raw.clientId ?? '').trim(),
};

/** Whether sign-in is possible at all in this build. */
export const auth0Configured = auth0Config.domain !== '' && auth0Config.clientId !== '';

export const auth0Issuer = auth0Configured ? `https://${auth0Config.domain}` : '';
