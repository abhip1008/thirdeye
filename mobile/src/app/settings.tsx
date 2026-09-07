import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { Header } from '@/components/Header';
import { Button, Choice, Divider, Muted, Screen, SectionLabel, SettingRow } from '@/components/ui';
import { megabytes } from '@/lib/format';
import { clearFootage, footageBytes, importFootage, listFootage } from '@/privacy/footage';
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
  const [importNote, setImportNote] = useState<string | null>(null);

  /* A synchronous filesystem read, recomputed when the clip count changes or
     after a wipe. Derived rather than held in state: an effect that sets state
     on mount just costs an extra render pass. */
  // The deps are a refresh trigger, not inputs: totalBytesHeld reads the
  // filesystem and takes no arguments.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bytes = useMemo(() => totalBytesHeld(), [clips.length, storageToken]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const footage = useMemo(() => listFootage(), [storageToken]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const footageSize = useMemo(() => footageBytes(), [storageToken]);

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
        The mock vest answers your taps and cuts clips out of a pretend buffer, so the whole loop
        works before a camera exists. It drops about one delivery in twelve on purpose, so the grey
        dot is something you have seen before it matters.
      </Muted>
      <Muted style={{ marginBottom: space.md }}>
        Turn it off to talk to a real vest at {pairing.host ?? 'the paired address'} instead. The
        app is the same either way; only what is behind the link changes.
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
            { value: 'manual', label: 'You tap' },
            { value: 'fast', label: 'Auto 10s' },
            { value: 'realistic', label: 'Auto 40s' },
          ]}
        />
        <Muted style={{ marginTop: space.sm }}>
          Auto modes bowl on a timer, for showing someone a full over without tapping through it.
        </Muted>
      </View>

      <Divider />

      <SectionLabel>Your own footage</SectionLabel>
      <Muted style={{ marginBottom: space.md }}>
        The bundled clip is a test pattern - right for checking that frame stepping is exact, and
        useless for the question that decides whether this works at all: is the impact zone even in
        shot from an umpire&apos;s chest? Import a video and every delivery plays it instead.
      </Muted>
      <SettingRow
        label={footage.length > 0 ? 'Imported videos' : 'No videos imported'}
        value={footage.length > 0 ? `${footage.length} · ${megabytes(footageSize)}` : undefined}
        hint={
          footage.length > 1
            ? 'Deliveries cycle through them, so consecutive balls do not look identical.'
            : undefined
        }
      />
      <Button
        label="Add a video"
        variant="secondary"
        onPress={() =>
          void importFootage().then((r) => {
            setStorageToken((n) => n + 1);
            setImportNote(
              r.error
                ? `Could not import: ${r.error}`
                : r.cancelled
                  ? null
                  : `Imported ${r.imported} video${r.imported === 1 ? '' : 's'}. The next ball will use it.`
            );
          })
        }
        style={{ marginTop: space.sm }}
      />
      {footage.length > 0 && (
        <Button
          label="Remove imported videos"
          variant="ghost"
          onPress={() => {
            const removed = clearFootage();
            setStorageToken((n) => n + 1);
            setImportNote(`Removed ${removed}. Back to the test pattern.`);
          }}
          style={{ marginTop: space.xs }}
        />
      )}
      {importNote ? <Muted style={{ marginTop: space.sm }}>{importNote}</Muted> : null}
      <Muted style={{ marginTop: space.sm, marginBottom: space.lg }}>
        Chosen through the system file picker, one file at a time, so the app never needs access to
        your photo library. Imports are stored like clips are: app-private, kept out of the platform
        backup, and removed by &ldquo;Delete all data&rdquo; below.
      </Muted>

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
