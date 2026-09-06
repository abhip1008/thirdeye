import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Header } from '@/components/Header';
import { Button, Choice, Field, Muted, Screen, SectionLabel, Title } from '@/components/ui';
import { recentVenues } from '@/db/queries';
import { useClips } from '@/stores/clipStore';
import { useMatch } from '@/stores/matchStore';
import { usePairing } from '@/stores/pairingStore';
import { useSettings } from '@/stores/settingsStore';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/spacing';
import { type } from '@/theme/typography';
import type { UmpireEnd } from '@/types/protocol';

/**
 * Start a match.
 *
 * Everything here has a sensible default already filled in, because this screen
 * is used at the toss with a captain waiting. The only interaction that should
 * ever be needed is tapping Start.
 */
export default function SetupScreen() {
  const router = useRouter();
  const pairing = usePairing();
  const settings = useSettings();
  const [venue, setVenue] = useState('');
  const [name, setName] = useState('');
  const [end, setEnd] = useState<UmpireEnd>('bowlers');
  const [venues, setVenues] = useState<string[]>([]);

  useEffect(() => {
    void recentVenues().then(setVenues);
  }, []);

  const start = async () => {
    const match = await useMatch.getState().startMatch({
      name: name || `${new Date().toLocaleDateString()} ${venue}`.trim(),
      venue,
      cameraId: pairing.cameraId ?? 'vest-01',
      umpireEnd: end,
      ringSize: settings.ringSize,
    });
    useClips.getState().reset();
    await useClips.getState().hydrate(match.id);
    router.replace('/live');
  };

  return (
    <Screen scroll>
      <Header title="New match" />

      <View style={s.head}>
        <Title>Start a match</Title>
        <Muted style={{ marginTop: space.sm }}>
          {pairing.paired
            ? `Paired with ${pairing.cameraId}.`
            : 'No vest paired yet. The mock vest will be used.'}
        </Muted>
      </View>

      <Field
        label="Ground"
        value={venue}
        onChangeText={setVenue}
        placeholder="Marymoor"
        hint="Used to name the match. No team or player names are stored."
      />

      {venues.length > 0 && (
        <View style={s.recent}>
          {venues.map((v) => (
            <Pressable
              key={v}
              onPress={() => setVenue(v)}
              accessibilityRole="button"
              style={({ pressed }) => [s.chip, pressed && { opacity: 0.6 }]}
            >
              <Text style={[type.caption, { color: colors.text }]}>{v}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Field
        label="Match name"
        value={name}
        onChangeText={setName}
        placeholder="Optional"
        hint="Leave it blank and the date and ground are used."
      />

      <View style={{ marginBottom: space.xl }}>
        <SectionLabel>Where you are standing</SectionLabel>
        <Choice<UmpireEnd>
          value={end}
          onChange={setEnd}
          options={[
            { value: 'bowlers', label: "Bowler's end" },
            { value: 'square_leg', label: 'Square leg' },
          ]}
        />
        <Muted style={{ marginTop: space.sm }}>
          Recorded on the match so clips can be told apart when a second vest is added.
        </Muted>
      </View>

      <View style={s.actions}>
        <Button label="Start match" onPress={() => void start()} />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  head: { paddingTop: space.xl, paddingBottom: space.xl },
  recent: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: -space.md, marginBottom: space.xl },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  actions: { marginTop: space.lg, paddingBottom: space.xl },
});
