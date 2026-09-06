import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Body, Button, Field, Muted, Screen, Title } from '@/components/ui';
import { log } from '@/lib/log';
import { parsePairingQr, usePairing } from '@/stores/pairingStore';
import { useSettings } from '@/stores/settingsStore';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/spacing';
import { type } from '@/theme/typography';

/**
 * Pair with the vest.
 *
 * The manual entry field is not a fallback for later, it is a day-one feature.
 * Scanning a QR code off a printed label in direct sun, at the toss, wearing a
 * hat, does not work as reliably as anyone demonstrating it indoors believes.
 */
export default function PairScreen() {
  const router = useRouter();
  const pairing = usePairing();
  const acknowledged = useSettings((s) => s.noticeAcknowledged);
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<'scan' | 'manual'>('scan');
  const [host, setHost] = useState('192.168.43.1');
  const [cameraId, setCameraId] = useState('vest-01');
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    void pairing.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const proceed = () => router.push(acknowledged ? '/setup' : '/notice');

  const onScanned = async ({ data }: { data: string }) => {
    if (handled.current) return;
    const payload = parsePairingQr(data);
    if (!payload) {
      setError('That code is not a Third Eye pairing code.');
      return;
    }
    handled.current = true;
    await pairing.savePayload(payload);
    log.info('pairing', 'scanned pairing code');
    proceed();
  };

  const onManual = async () => {
    if (!host.trim()) {
      setError('Enter the address printed on the vest.');
      return;
    }
    await pairing.saveManual(host.trim(), cameraId.trim() || 'vest-01');
    proceed();
  };

  return (
    <Screen scroll>
      <View style={s.head}>
        <Title>Pair with the vest</Title>
        <Muted style={{ marginTop: space.sm }}>
          Scan the code printed on the vest. Once per season, not once per match.
        </Muted>
      </View>

      {mode === 'scan' ? (
        <View style={s.viewfinder}>
          {permission?.granted ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={onScanned}
            />
          ) : (
            <View style={s.permission}>
              <Body style={{ textAlign: 'center' }}>
                The camera is used once, to read the pairing code.
              </Body>
              <Muted style={{ textAlign: 'center', marginTop: space.sm }}>
                Third Eye never records video on the phone.
              </Muted>
              <Button
                label={permission ? 'Allow the camera' : 'Checking…'}
                onPress={() => void requestPermission()}
                style={{ marginTop: space.lg, alignSelf: 'stretch' }}
              />
            </View>
          )}
        </View>
      ) : (
        <View style={s.manual}>
          <Field
            label="Vest address"
            value={host}
            onChangeText={setHost}
            placeholder="192.168.43.1"
            hint="Printed under the QR code on the vest."
          />
          <Field label="Vest name" value={cameraId} onChangeText={setCameraId} placeholder="vest-01" />
        </View>
      )}

      {error ? <Text style={[type.caption, s.error]}>{error}</Text> : null}

      <View style={s.actions}>
        {mode === 'manual' ? (
          <Button label="Pair" onPress={() => void onManual()} />
        ) : (
          <Button label="Continue without scanning" onPress={proceed} variant="secondary" />
        )}
        <Pressable
          onPress={() => {
            setError(null);
            setMode(mode === 'scan' ? 'manual' : 'scan');
          }}
          accessibilityRole="button"
          style={({ pressed }) => [s.switcher, pressed && { opacity: 0.5 }]}
        >
          <Text style={[type.body, { color: colors.accent }]}>
            {mode === 'scan' ? 'Enter the address by hand' : 'Scan the code instead'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => router.push('/notice')}
          accessibilityRole="button"
          style={({ pressed }) => [s.switcher, pressed && { opacity: 0.5 }]}
        >
          <Text style={[type.caption, { color: colors.textMuted }]}>
            What does Third Eye record?
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  head: { paddingTop: space.xxl, paddingBottom: space.xl },
  viewfinder: {
    aspectRatio: 1,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSunk,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  permission: { padding: space.xl },
  manual: { paddingTop: space.sm },
  error: { color: colors.danger, marginTop: space.lg },
  actions: { marginTop: space.xl, gap: space.md },
  switcher: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
