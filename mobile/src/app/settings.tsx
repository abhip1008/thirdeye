import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { Header } from '@/components/Header';
import { Button, Choice, Divider, Muted, Screen, SectionLabel, SettingRow } from '@/components/ui';
import { megabytes } from '@/lib/format';
import { purgeEverything } from '@/privacy/retention';
import { totalBytesHeld } from '@/privacy/storage';
import { useClips } from '@/stores/clipStore';
import { useMatch } from '@/stores/matchStore';
import { usePairing } from '@/stores/pairingStore';
import { MockSpeed, useSettings } from '@/stores/settingsStore';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/spacing';
import { type } from '@/theme/typography';
import { PROTOCOL_VERSION } from '@/types/protocol';

/**
 * Settings, with the privacy panel first.
 *
 * "What is on this phone" sits at the top rather than in an About page because
 * it is the answer to the only question anyone outside the project ever asks,
 * and an umpire should be able to get to it while someone is standing in front
 * of them.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const settings = useSettings();
  const pairing = usePairing();
  const clips = useClips((s) => s.clips);
  const match = useMatch((s) => s.match);

  const [confirmWipe, setConfirmWipe] = useState(false);
  const [storageToken, setStorageToken] = useState(0);

  /* A synchronous filesystem read, recomputed when the clip count changes or
     after a wipe. Derived rather than held in state: an effect that sets state
     on mount just costs an extra render pass. */
  // The deps are a refresh trigger, not inputs: totalBytesHeld reads the
  // filesystem and takes no arguments.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bytes = useMemo(() => totalBytesHeld(), [clips.length, storageToken]);

  const kept = clips.filter((c) => c.pinned).length;

  const wipe = async () => {
    await purgeEverything();
    useClips.getState().reset();
    await pairing.forget();
    setConfirmWipe(false);
    setStorageToken((n) => n + 1);
    router.replace('/');
  };

  return (
    <Screen scroll>
      <Header title="Settings" />

      <View style={s.privacy}>
        <SectionLabel>What is on this phone</SectionLabel>
        <Text style={[type.body, { color: colors.text }]}>
          {clips.length} clip{clips.length === 1 ? '' : 's'} · {megabytes(bytes)}
        </Text>
        <Muted style={{ marginTop: space.xs }}>
          {kept > 0
            ? `${kept} kept, deleted automatically after ${settings.pinRetentionDays} days. The rest roll off after ${settings.ringSize} balls.`
            : `Nothing is kept. Clips are deleted after ${settings.ringSize} balls.`}
        </Muted>
        <Muted style={{ marginTop: space.sm }}>
          No sound is recorded. Nothing is uploaded. During a match this phone talks to the vest
          and to nothing else.
        </Muted>
        <Button
          label="What Third Eye records"
          variant="secondary"
          onPress={() => router.push('/notice')}
          style={{ marginTop: space.lg }}
        />
      </View>

      <SectionLabel>Recording</SectionLabel>
      <Preset
        label="Pre-roll"
        hint="Seconds pulled from before the START press, so a late press still catches the run-up."
        value={settings.prerollSeconds}
        options={[2, 3, 5]}
        suffix="s"
        onChange={(v) => void settings.set('prerollSeconds', v)}
      />
      <Preset
        label="Auto-close"
        hint="How long a clip runs with no END press. 40s covers a run-out and three runs."
        value={settings.timeoutSeconds}
        options={[25, 40, 60]}
        suffix="s"
        onChange={(v) => void settings.set('timeoutSeconds', v)}
      />

      <SectionLabel>Retention</SectionLabel>
      <Preset
        label="Balls kept"
        hint="Older clips are deleted from this phone as soon as the ring rolls."
        value={settings.ringSize}
        options={[6, 12, 24]}
        onChange={(v) => void settings.set('ringSize', v)}
      />
      <Preset
        label="Keep pinned for"
        hint="A pin buys a clip time, not permanence. It expires on its own."
        value={settings.pinRetentionDays}
        options={[1, 7, 30]}
        suffix=" days"
        onChange={(v) => void settings.set('pinRetentionDays', v)}
      />
      <SettingRow
        label="Block screenshots"
        hint="Stops a clip escaping the retention rules through a camera roll."
      />
      <View style={s.switchRow}>
        <Switch
          value={settings.screenGuard}
          onValueChange={(v) => void settings.set('screenGuard', v)}
          accessibilityLabel="Block screenshots"
        />
      </View>

      <Divider />

      <SectionLabel>Vest</SectionLabel>
      <SettingRow label="Address" value={pairing.host ?? 'not paired'} />
      <SettingRow label="Name" value={pairing.cameraId ?? '—'} />
      <SettingRow label="Protocol" value={`v${PROTOCOL_VERSION}`} />
      <SettingRow
        label="Forget this vest"
        hint="Clears the address and the stored Wi-Fi passphrase."
        onPress={() => void pairing.forget()}
      />

      <Divider />

      <SectionLabel>Mock vest</SectionLabel>
      <Muted style={{ marginBottom: space.md }}>
        Phase 1 has no hardware. The mock vest bowls on a timer so every part of the app can be
        used and judged before a camera exists. This stays in the build until field trials.
      </Muted>
      <SettingRow label="Mock vest running" />
      <View style={s.switchRow}>
        <Switch
          value={settings.mockEnabled}
          onValueChange={(v) => void settings.set('mockEnabled', v)}
          accessibilityLabel="Mock vest running"
        />
      </View>
      <View style={{ marginTop: space.md, marginBottom: space.xl }}>
        <Choice<MockSpeed>
          value={settings.mockSpeed}
          onChange={(v) => void settings.set('mockSpeed', v)}
          options={[
            { value: 'realistic', label: '40s' },
            { value: 'fast', label: '10s' },
            { value: 'frozen', label: 'Frozen' },
          ]}
        />
        <Muted style={{ marginTop: space.sm }}>Seconds between deliveries.</Muted>
      </View>

      <SettingRow
        label="Diagnostics"
        hint="Message log, audit trail, link detail."
        onPress={() => router.push('/diagnostics')}
      />

      <Divider />

      <SectionLabel>Delete</SectionLabel>
      {match && (
        <SettingRow
          label="Delete clips from this match"
          hint="Keeps the match record and the decision log."
          onPress={() => void useClips.getState().sweep()}
        />
      )}
      {confirmWipe ? (
        <View style={s.confirm}>
          <Text style={[type.body, { color: colors.text }]}>
            This deletes every clip, every match, every decision and the paired vest. It cannot be
            undone.
          </Text>
          <View style={s.confirmRow}>
            <Button label="Delete everything" variant="danger" onPress={() => void wipe()} style={{ flex: 1 }} />
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => setConfirmWipe(false)}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      ) : (
        <SettingRow
          label="Delete all data on this phone"
          hint="Clips, matches, decisions, and the pairing."
          destructive
          onPress={() => setConfirmWipe(true)}
        />
      )}

      <View style={{ height: space.xxxl }} />
    </Screen>
  );
}

function Preset({
  label,
  hint,
  value,
  options,
  suffix = '',
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  options: number[];
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <View style={s.preset}>
      <SettingRow label={label} hint={hint} value={`${value}${suffix}`} />
      <Choice<string>
        value={String(value)}
        onChange={(v) => onChange(Number(v))}
        options={options.map((o) => ({ value: String(o), label: `${o}${suffix}` }))}
      />
    </View>
  );
}

const s = StyleSheet.create({
  privacy: {
    marginTop: space.lg,
    marginBottom: space.xl,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  preset: { marginBottom: space.lg },
  switchRow: { alignItems: 'flex-start', paddingBottom: space.lg },
  confirm: { paddingVertical: space.lg, gap: space.lg },
  confirmRow: { flexDirection: 'row', gap: space.md },
});
