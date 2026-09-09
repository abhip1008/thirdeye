import { Stack, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DeliveryBar } from '@/components/DeliveryBar';
import { Screen, Body, Title } from '@/components/ui';
import { getDb } from '@/db/client';
import { log } from '@/lib/log';
import { trimAuditLog } from '@/privacy/audit';
import { useClips } from '@/stores/clipStore';
import { useDelivery } from '@/stores/deliveryStore';
import { useMatch } from '@/stores/matchStore';
import { useSettings } from '@/stores/settingsStore';
import { colors } from '@/theme/colors';
import { space } from '@/theme/spacing';
import { View } from 'react-native';

/**
 * Boot order matters and is short enough to state:
 *
 *   1. open the database and run migrations   (nothing works without it)
 *   2. load settings                          (retention values come from here)
 *   3. resume an unfinished match, if any     (the app was killed mid-over)
 *   4. trim the audit log, sweep retention    (before a single clip is shown)
 *
 * Step 4 runs on every launch, not on a timer and not when the vest asks.
 * If this phone never sees a vest again, the clips still expire on schedule.
 */
/**
 * Screens where the delivery control belongs: the clip list, and nowhere else.
 *
 * It used to follow onto the review player, on the reasoning that a bowler
 * might start running in while the umpire was watching the last ball. In use
 * that was wrong. A review happens with play stopped, the screen is small, and a
 * large button under a video the umpire is studying frame by frame is a button
 * they will eventually hit by accident - which starts a delivery that is not
 * happening and, worse, ends the one that is.
 *
 * Also absent from pairing, setup, settings and diagnostics, where a stray tap
 * would open a delivery nobody meant to start.
 */
const CONTROL_ROUTES = ['/live'];

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const pathname = usePathname();
  const match = useMatch((state) => state.match);

  useEffect(() => {
    (async () => {
      try {
        await getDb();
        await useSettings.getState().load();
        await useMatch.getState().hydrate();

        const match = useMatch.getState().match;
        if (match) {
          await useClips.getState().hydrate(match.id);
          await useClips.getState().sweep();
          await useDelivery.getState().hydrate(match.id);
        }
        await trimAuditLog();

        setReady(true);
        log.info('boot', 'ready');
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log.error('boot', 'startup failed', { error: message });
        setFailure(message);
      }
    })();
  }, []);

  if (failure) {
    return (
      <SafeAreaProvider>
        <Screen>
          <Title style={{ marginTop: space.xxl }}>Could not start</Title>
          <Body style={{ marginTop: space.md, color: colors.textMuted }}>{failure}</Body>
        </Screen>
      </SafeAreaProvider>
    );
  }

  if (!ready) {
    return (
      <SafeAreaProvider>
        <Screen />
      </SafeAreaProvider>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
              animation: 'fade',
            }}
          />
          {match && CONTROL_ROUTES.some((r) => pathname.startsWith(r)) && <DeliveryBar />}
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
