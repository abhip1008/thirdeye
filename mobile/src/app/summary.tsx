import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Header } from '@/components/Header';
import { StatusDot } from '@/components/StatusDot';
import { Body, Button, Divider, Muted, Screen, SectionLabel, Title } from '@/components/ui';
import { listReviews } from '@/db/queries';
import { megabytes } from '@/lib/format';
import { purgeUnpinned } from '@/privacy/retention';
import { useClips } from '@/stores/clipStore';
import { useMatch } from '@/stores/matchStore';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/spacing';
import { type } from '@/theme/typography';
import type { Review } from '@/types/clip';

/**
 * End of match.
 *
 * The primary action here deletes things, which is unusual and deliberate. The
 * promise made to twenty-two players is that the footage goes away; the moment
 * the match ends is when that promise comes due, and it should take one tap
 * rather than a trip through settings.
 */
export default function SummaryScreen() {
  const router = useRouter();
  const match = useMatch((s) => s.match);
  const deliveries = useMatch((s) => s.deliveryCount);
  const clips = useClips((s) => s.clips);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [purged, setPurged] = useState<number | null>(null);

  useEffect(() => {
    if (match) void listReviews(match.id).then(setReviews);
  }, [match]);

  const ready = clips.filter((c) => c.status === 'ready');
  const missed = deliveries - clips.length;
  const kept = clips.filter((c) => c.pinned);
  const bytes = ready.reduce((sum, c) => sum + c.bytesLocal, 0);

  const finish = async () => {
    if (!match) return;
    const result = await purgeUnpinned(match.id);
    await useMatch.getState().endMatch();
    await useClips.getState().hydrate(match.id);
    setPurged(result.deleted);
  };

  if (!match) {
    return (
      <Screen>
        <Header title="Summary" />
        <Muted style={{ padding: space.xl }}>No match to summarise.</Muted>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header title="End of match" />

      <View style={s.head}>
        <Title>{match.name}</Title>
        <Muted style={{ marginTop: space.xs }}>
          {match.venue ?? 'No ground recorded'} · {match.cameraId}
        </Muted>
      </View>

      <View style={s.stats}>
        <Stat label="Deliveries" value={String(deliveries)} />
        <Stat label="Clips held" value={String(ready.length)} />
        <Stat label="Missed" value={missed > 0 ? String(missed) : '0'} />
        <Stat label="On phone" value={megabytes(bytes)} />
      </View>

      <SectionLabel>Reviews called</SectionLabel>
      {reviews.length === 0 ? (
        <Muted style={{ marginBottom: space.xl }}>No reviews were called this match.</Muted>
      ) : (
        <View style={s.block}>
          {reviews.map((r) => (
            <View key={r.id} style={s.reviewRow}>
              <Text style={[type.numeral, { color: colors.text }]}>Ball {r.seq}</Text>
              <Text style={[type.body, { color: colors.textMuted }]}>
                {r.decision === 'out' ? 'Out' : r.decision === 'not_out' ? 'Not out' : 'Unclear'}
              </Text>
            </View>
          ))}
        </View>
      )}

      <SectionLabel>Kept clips</SectionLabel>
      {kept.length === 0 ? (
        <Muted style={{ marginBottom: space.xl }}>
          Nothing was kept. Everything from this match will be deleted.
        </Muted>
      ) : (
        <View style={s.block}>
          {kept.map((c) => (
            <View key={`${c.camera_id}:${c.seq}`} style={s.reviewRow}>
              <View style={s.keptLeft}>
                <StatusDot status={c.status} />
                <Text style={[type.numeral, { color: colors.text }]}>Ball {c.seq}</Text>
              </View>
              <Text style={[type.caption, { color: colors.textMuted }]}>
                {c.pinReason ?? 'kept'}
                {c.purgeAfter
                  ? ` · until ${new Date(c.purgeAfter * 1000).toLocaleDateString()}`
                  : ''}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Divider />

      {purged === null ? (
        <View style={s.actions}>
          <Body style={{ marginBottom: space.md }}>
            Ending the match deletes every clip that was not kept, right now, on this phone.
          </Body>
          <Button label="End match and delete the rest" onPress={() => void finish()} />
          <Button
            label="Not yet, go back"
            variant="ghost"
            onPress={() => router.back()}
            style={{ marginTop: space.sm }}
          />
        </View>
      ) : (
        <View style={s.actions}>
          <Body>
            Match ended. {purged} clip{purged === 1 ? '' : 's'} deleted.
            {kept.length > 0 ? ` ${kept.length} kept.` : ''}
          </Body>
          <Muted style={{ marginTop: space.sm }}>
            Kept clips are deleted automatically when their date passes.
          </Muted>
          <Button
            label="Done"
            onPress={() => router.replace('/setup')}
            style={{ marginTop: space.lg }}
          />
        </View>
      )}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.stat}>
      <Text style={[type.counterHuge, { fontSize: 30, color: colors.text }]}>{value}</Text>
      <Text style={[type.caption, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  head: { paddingTop: space.xl, paddingBottom: space.lg },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.lg,
    marginBottom: space.xl,
  },
  stat: { width: '50%', paddingVertical: space.sm },
  block: { marginBottom: space.xl },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  keptLeft: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  actions: { paddingTop: space.xl, paddingBottom: space.xxl },
});
