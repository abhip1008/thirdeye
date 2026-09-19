import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Header } from '@/components/Header';
import {
  Button,
  Card,
  Choice,
  Muted,
  Screen,
  SectionLabel,
  SettingRow,
  ToggleRow,
} from '@/components/ui';
import { megabytes } from '@/lib/format';
import { clearFootage, footageBytes, importFootage, listFootage } from '@/privacy/footage';
import { purgeEverything } from '@/privacy/retention';
import { totalBytesHeld } from '@/privacy/storage';
import { useClips } from '@/stores/clipStore';
import { useConnection } from '@/stores/connectionStore';
import { useMatch } from '@/stores/matchStore';
import { usePairing } from '@/stores/pairingStore';
import { useAuth } from '@/stores/authStore';
import { MockSpeed, useSettings } from '@/stores/settingsStore';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/spacing';
import { type } from '@/theme/typography';
import { PROTOCOL_VERSION } from '@/types/protocol';

/**
 * Settings, grouped by who is asking.
 *
 * "What is on this phone" sits at the top rather than in an About page because
 * it is the answer to the only question anyone outside the project ever asks,
 * and an umpire should be able to get to it while someone is standing in front
 * of them.
 *
 * Below that, the order is: things an umpire changes, then the vest they are
 * paired to, then developer tools, then the things that delete. The mock vest
 * and the footage importer used to sit in the middle of the umpire's settings,
 * which made a screen for running a match read like a workbench.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const auth = useAuth();
  const settings = useSettings();
  const pairing = usePairing();
  const clips = useClips((s) => s.clips);
  const match = useMatch((s) => s.match);
  const preroll = useConnection((s) => s.prerollSeconds);

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
        <Text style={[type.title, { color: colors.text }]}>
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

      <SectionLabel>Account</SectionLabel>
      <View style={s.account}>
        {auth.identity ? (
          <>
            <Text style={[type.body, { color: colors.text }]}>
              {auth.identity.name ?? auth.identity.email ?? 'Signed in'}
            </Text>
            {auth.identity.email && auth.identity.name ? (
              <Muted style={{ marginTop: space.xs }}>{auth.identity.email}</Muted>
            ) : null}
            <Muted style={{ marginTop: space.sm }}>
              {auth.isStale()
                ? 'Past its expiry, which changes nothing. Third Eye has simply not been able to check in recently.'
                : 'Third Eye works signed out too. Nothing on any screen is locked.'}
            </Muted>
            <Button
              label="Manage account"
              variant="secondary"
              onPress={() => router.push('/signin')}
              style={{ marginTop: space.lg }}
            />
          </>
        ) : (
          <>
            <Text style={[type.body, { color: colors.text }]}>Not signed in</Text>
            <Muted style={{ marginTop: space.xs }}>
              Optional. Everything works without it — and signing in needs internet, which the
              vest&apos;s own network does not have.
            </Muted>
            <Button
              label="Sign in"
              onPress={() => router.push('/signin')}
              style={{ marginTop: space.lg }}
            />
          </>
        )}
      </View>

      <SectionLabel>Recording</SectionLabel>
      <Card>
        <SettingRow
          label="Pre-roll"
          hint="Seconds of run-up added before every tap, so a late press still catches the bowler coming in. Set on the vest, because that is where the cut happens."
          value={preroll === null ? 'ask the vest' : `${preroll}s`}
        />
        <Preset
          label="Auto-close"
          hint="How long a clip runs with no END press. 40s covers a run-out and three runs."
          value={settings.timeoutSeconds}
          options={[25, 40, 60]}
          format={(v) => `${v}s`}
          onChange={(v) => void settings.set('timeoutSeconds', v)}
        />
      </Card>

      <SectionLabel>Retention</SectionLabel>
      <Card>
        <Preset
          label="Balls kept"
          hint="Older clips are deleted from this phone as soon as the ring rolls."
          value={settings.ringSize}
          options={[6, 12, 24]}
          format={(v) => `${v} balls`}
          onChange={(v) => void settings.set('ringSize', v)}
        />
        <Preset
          label="Keep pinned for"
          hint="A pin buys a clip time, not permanence. It expires on its own."
          value={settings.pinRetentionDays}
          options={[1, 7, 30]}
          format={(v) => (v === 1 ? '1 day' : `${v} days`)}
          onChange={(v) => void settings.set('pinRetentionDays', v)}
        />
        <ToggleRow
          label="Block screenshots"
          hint="Stops a clip escaping the retention rules through a camera roll."
          value={settings.screenGuard}
          onValueChange={(v) => void settings.set('screenGuard', v)}
        />
      </Card>

      <SectionLabel>Vest</SectionLabel>
      <Card>
        <SettingRow label="Address" value={pairing.host ?? 'not paired'} />
        <SettingRow label="Name" value={pairing.cameraId ?? '—'} />
        <SettingRow label="Protocol" value={`v${PROTOCOL_VERSION}`} />
        <SettingRow
          label={pairing.paired ? 'Pair a different vest' : 'Pair a vest'}
          hint={
            pairing.paired
              ? 'Point this phone at another vest, or re-enter the key.'
              : 'Enter the address and key from the label on the vest.'
          }
          onPress={() => router.push('/?repair=1')}
        />
        {pairing.paired ? (
          <SettingRow
            label="Forget this vest"
            hint="Clears the address, the Wi-Fi passphrase and the signing key. Does not sign you out."
            onPress={() => void pairing.forget()}
          />
        ) : null}
      </Card>

      <SectionLabel>Developer</SectionLabel>
      <Card>
        <ToggleRow
          label="Mock vest"
          hint="Answers your taps and cuts clips from a pretend buffer, so the whole loop works without hardware. Drops about one delivery in twelve on purpose."
          value={settings.mockEnabled}
          onValueChange={(v) => void settings.set('mockEnabled', v)}
        />
        {settings.mockEnabled ? (
          <View style={s.inset}>
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
              Auto modes bowl on a timer, for showing someone a full over without tapping through
              it.
            </Muted>
          </View>
        ) : null}
        <SettingRow
          label={footage.length > 0 ? 'Imported videos' : 'Your own footage'}
          value={footage.length > 0 ? `${footage.length} · ${megabytes(footageSize)}` : undefined}
          hint="The bundled clip is a test pattern. Import a video and every delivery plays it instead."
        />
        <View style={s.inset}>
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
        </View>
        <SettingRow
          label="Diagnostics"
          hint="Message log, audit trail, link detail."
          onPress={() => router.push('/diagnostics')}
        />
      </Card>

      <SectionLabel>Delete</SectionLabel>
      <Card>
        {match ? (
          <SettingRow
            label="Delete clips from this match"
            hint="Keeps the match record and the decision log."
            onPress={() => void useClips.getState().sweep()}
          />
        ) : null}
        {confirmWipe ? (
          <View style={s.confirm}>
            <Text style={[type.body, { color: colors.text }]}>
              This deletes every clip, every match, every decision, the paired vest and your
              sign-in. It cannot be undone.
            </Text>
            <View style={s.confirmRow}>
              <Button
                label="Delete everything"
                variant="danger"
                onPress={() => void wipe()}
                style={{ flex: 1 }}
              />
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
            hint="Clips, matches, decisions, the pairing and your sign-in."
            destructive
            onPress={() => setConfirmWipe(true)}
          />
        )}
      </Card>

      <View style={{ height: space.xxl }} />
    </Screen>
  );
}

function Preset({
  label,
  hint,
  value,
  options,
  format = (v) => String(v),
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  options: number[];
  /** How the number reads. A function, because "1 days" is not a unit. */
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <View style={s.preset}>
      <SettingRow label={label} hint={hint} value={format(value)} />
      <Choice<string>
        value={String(value)}
        onChange={(v) => onChange(Number(v))}
        options={options.map((o) => ({ value: String(o), label: format(o) }))}
      />
    </View>
  );
}

const s = StyleSheet.create({
  account: {
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginBottom: space.xl,
  },
  inset: { paddingBottom: space.lg },
  privacy: {
    marginTop: space.lg,
    marginBottom: space.xl,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  preset: { paddingBottom: space.lg },
  switchRow: { alignItems: 'flex-start', paddingBottom: space.lg },
  confirm: { paddingVertical: space.lg, gap: space.lg },
  confirmRow: { flexDirection: 'row', gap: space.md },
});
