import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Screen, Body, Title } from '@/components/ui';
import { getDb } from '@/db/client';
import { log } from '@/lib/log';
import { trimAuditLog } from '@/privacy/audit';
import { useClips } from '@/stores/clipStore';
import { useMatch } from '@/stores/matchStore';
import { useSettings } from '@/stores/settingsStore';
import { colors } from '@/theme/colors';
import { space } from '@/theme/spacing';

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
export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

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
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: 'fade',
          }}
        />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
