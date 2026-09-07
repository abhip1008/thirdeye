import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Header } from '@/components/Header';
import { Button, Muted, Screen, SectionLabel, SettingRow } from '@/components/ui';
import { LogEntry, log } from '@/lib/log';
import { AuditRow, recentAudit } from '@/privacy/audit';
import { useConnection } from '@/stores/connectionStore';
import { useDelivery } from '@/stores/deliveryStore';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/spacing';
import { type } from '@/theme/typography';

/**
 * Where Phase 3 will be spent.
 *
 * Two lists: what the app did, and what happened to people's footage. The
 * second one is the interesting half. Secrets are redacted on the way in, not
 * on the way out, so nothing sensitive is ever in the buffer this screen reads.
 */
export default function DiagnosticsScreen() {
  const connection = useConnection();
  const queued = useDelivery((s) => s.queued);
  const [lines, setLines] = useState<LogEntry[]>(log.tail());
  const [trail, setTrail] = useState<AuditRow[]>([]);

  useEffect(() => log.subscribe(() => setLines(log.tail())), []);
  useEffect(() => {
    void recentAudit(80).then(setTrail);
  }, [lines.length]);

  return (
    <Screen>
      <Header title="Diagnostics" />

      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={{ paddingTop: space.lg }}>
          <SectionLabel>Link</SectionLabel>
          <SettingRow label="State" value={connection.state} />
          <SettingRow label="Transport" value={connection.transportName ?? '—'} />
          <SettingRow label="Vest" value={connection.cameraId ?? '—'} />
          <SettingRow label="Firmware" value={connection.firmware ?? '—'} />
          <SettingRow label="Protocol" value={connection.vestProtocol ? `v${connection.vestProtocol}` : '—'} />
          <SettingRow label="Round trip" value={connection.rttMs !== null ? `${connection.rttMs} ms` : '—'} />
          <SettingRow
            label="Clock offset"
            hint="Applied to every delivery marker, so the vest gets its own time."
            value={`${connection.clockOffset >= 0 ? '+' : ''}${connection.clockOffset.toFixed(2)} s`}
          />
          <SettingRow
            label="Buffer"
            hint="How far back the vest can still cut a clip."
            value={connection.bufferSeconds !== null ? `${connection.bufferSeconds} s` : '—'}
          />
          <SettingRow
            label="Markers waiting"
            hint="Taps written down but not yet acknowledged by the vest."
            value={String(queued)}
          />
          {connection.protocolMismatch && (
            <Muted style={{ color: colors.danger }}>
              The vest speaks a newer protocol than this build. Update the app.
            </Muted>
          )}
        </View>

        <View style={{ paddingTop: space.xl }}>
          <SectionLabel>What happened to the footage</SectionLabel>
          <View style={s.log}>
            {trail.length === 0 ? (
              <Muted>Nothing recorded yet.</Muted>
            ) : (
              trail.map((row) => (
                <Text key={row.id} style={[type.mono, s.line]}>
                  {new Date(row.ts * 1000).toLocaleTimeString()} {row.type}
                  {row.payload ? ` ${row.payload}` : ''}
                </Text>
              ))
            )}
          </View>
        </View>

        <View style={{ paddingTop: space.xl }}>
          <SectionLabel>Message log</SectionLabel>
          <View style={s.log}>
            {lines.map((l, i) => (
              <Text
                key={`${l.ts}-${i}`}
                style={[
                  type.mono,
                  s.line,
                  l.level === 'warn' && { color: colors.pending },
                  l.level === 'error' && { color: colors.danger },
                ]}
              >
                {new Date(l.ts).toLocaleTimeString()} [{l.tag}] {l.message}
              </Text>
            ))}
          </View>
          <Button
            label="Clear the log"
            variant="secondary"
            onPress={() => log.clear()}
            style={{ marginTop: space.lg, marginBottom: space.xxl }}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  log: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: 3,
  },
  line: { color: colors.textMuted },
});
