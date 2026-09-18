import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Header } from '@/components/Header';
import { auth0Configured } from '@/auth/config';
import { Body, Button, Muted, Screen, Title } from '@/components/ui';
import { redirectUri, useAuth } from '@/stores/authStore';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/spacing';
import { type } from '@/theme/typography';

/**
 * Sign in, optionally.
 *
 * Reachable from Settings and offered once on the way in - never in the way of
 * a match. A phone on the vest's access point has no internet, so an app that
 * insisted on a fresh token would be an app that stops working at a ground.
 *
 * The screen says what signing in is *for*, because right now it is for very
 * little: the decision log can carry a name, and league features later will
 * need an account. Presenting that as a requirement would be dishonest, so it
 * is presented as a choice, with "Not now" as a first-class answer rather than
 * a grudging link at the bottom.
 */
export default function SignInScreen() {
  const router = useRouter();
  const auth = useAuth();

  const onSignIn = async () => {
    const ok = await auth.signIn();
    if (ok) router.back();
  };

  const identity = auth.identity;

  return (
    <Screen scroll>
      <Header title="Sign in" />

      <View style={s.head}>
        <Title>{identity ? 'Signed in' : 'Sign in'}</Title>
        <Muted style={{ marginTop: space.sm }}>
          {identity
            ? 'Third Eye knows who you are on this phone.'
            : 'Optional. Third Eye works fully without it.'}
        </Muted>
      </View>

      {identity ? (
        <View style={s.card}>
          <Text style={[type.body, { color: colors.text }]}>
            {identity.name ?? identity.email ?? identity.sub}
          </Text>
          {identity.email && identity.name ? (
            <Muted style={{ marginTop: space.xs }}>{identity.email}</Muted>
          ) : null}
          {auth.isStale() ? (
            <Muted style={{ marginTop: space.sm }}>
              This sign-in is past its expiry date. Nothing stops working — it just means
              Third Eye has not been able to check with the sign-in service recently.
            </Muted>
          ) : null}
        </View>
      ) : (
        <>
          <Point
            heading="You do not need an account to umpire."
            body="Pairing, recording, reviewing and deleting all work signed out. Nothing on any screen is locked."
          />
          <Point
            heading="Today it does nothing you can see."
            body="No screen changes, no feature unlocks. It is here so that league features which genuinely need an account — shared decision logs, a vest issued to whoever is umpiring — have something to build on. Until then, signing in is a preference, not an upgrade."
          />
          <Point
            heading="It needs internet, once."
            body="During a match the phone is on the vest's own network, which has no internet at all. So sign in beforehand — on your own Wi-Fi — and Third Eye remembers it afterwards."
          />
          <Point
            heading="What is stored."
            body="Your name and email address, in the phone's keystore. Never sent to the vest — the vest has no idea who is holding the phone. Signing out erases it."
          />
        </>
      )}

      {auth.error ? <Text style={[type.caption, s.error]}>{auth.error}</Text> : null}

      {!auth0Configured ? (
        <View style={s.card}>
          <Body>Sign-in is not set up in this build.</Body>
          <Muted style={{ marginTop: space.xs }}>
            Add an Auth0 domain and client ID to app.json under expo.extra.auth0. Full steps
            are in docs/AUTH.md.
          </Muted>
        </View>
      ) : null}

      {/* Shown whether or not a tenant is configured, because a callback that
          does not match is the commonest way this fails - and Auth0's error for
          it says "Callback URL mismatch" without ever saying what was asked
          for. This is what was asked for. */}
      <View style={s.card}>
        <Muted>Allowed Callback URL for the Auth0 application:</Muted>
        <Text selectable style={[type.body, s.uri]}>
          {redirectUri}
        </Text>
      </View>

      <View style={s.actions}>
        {identity ? (
          <Button
            label="Sign out"
            variant="secondary"
            onPress={() => void auth.signOut()}
          />
        ) : (
          <Button
            label={auth.busy ? 'Opening…' : 'Sign in with Auth0'}
            onPress={() => void onSignIn()}
            disabled={auth.busy || !auth0Configured}
          />
        )}
        <Button label="Done" variant="secondary" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

function Point({ heading, body }: { heading: string; body: string }) {
  return (
    <View style={s.point}>
      <Text style={[type.body, { color: colors.text, fontWeight: '600' }]}>{heading}</Text>
      <Muted style={{ marginTop: space.xs }}>{body}</Muted>
    </View>
  );
}

const s = StyleSheet.create({
  head: { paddingTop: space.lg, paddingBottom: space.lg },
  point: { paddingVertical: space.md },
  card: {
    backgroundColor: colors.surfaceSunk,
    borderRadius: radius.lg,
    padding: space.lg,
    marginTop: space.md,
  },
  error: { color: colors.danger, marginTop: space.lg },
  uri: { color: colors.text, marginTop: space.xs, fontFamily: 'Menlo' },
  actions: { marginTop: space.xl, gap: space.md, paddingBottom: space.xl },
});
