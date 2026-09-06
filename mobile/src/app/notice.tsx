import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Header } from '@/components/Header';
import { Body, Button, Muted, Screen, Title } from '@/components/ui';
import { audit } from '@/privacy/audit';
import { useSettings } from '@/stores/settingsStore';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/spacing';
import { type } from '@/theme/typography';

/**
 * The screen an umpire turns around and shows a player who asks "are you
 * filming me?".
 *
 * It is written to be read out loud in fifteen seconds by someone standing on a
 * boundary, which is why it is short sentences and no legal register. The
 * honest answer is genuinely good, so the design leads with it rather than
 * burying it in a settings sub-page: nothing is kept.
 */
export default function NoticeScreen() {
  const router = useRouter();
  const settings = useSettings();
  const first = !settings.noticeAcknowledged;

  const acknowledge = async () => {
    await settings.set('noticeAcknowledged', true);
    await audit('privacy.notice.shown', null);
    router.replace('/setup');
  };

  return (
    <Screen scroll>
      {!first && <Header title="What Third Eye records" />}

      <View style={s.head}>
        <Title>What Third Eye records</Title>
      </View>

      <Point
        heading="The last twelve balls. Nothing else."
        body={`Each delivery becomes a short clip on the umpire's phone. When the thirteenth ball is bowled, the first one is deleted. Not archived, not uploaded, deleted.`}
      />
      <Point
        heading="No sound."
        body="The vest records picture only. Conversations on the field are not captured."
      />
      <Point
        heading="It stays on this phone."
        body={`During a match the phone talks to the vest and to nothing else. There is no cloud upload, no analytics, and no third party involved.`}
      />
      <Point
        heading="A kept clip has an expiry date."
        body={`If a wicket falls or a review is called, the umpire can keep that clip. Kept clips are deleted automatically after ${settings.pinRetentionDays} days. Keeping one buys it time, not permanence.`}
      />
      <Point
        heading="Nobody is identified."
        body="No names, no teams, no player records. A clip is a date, a ground, and a ball number."
      />
      <Point
        heading="You can ask, and see the answer."
        body="Settings shows exactly what is on this phone right now and lets the umpire delete all of it in one action."
      />

      <View style={s.limits}>
        <Text style={[type.captionStrong, { color: colors.textMuted }]}>WHAT IT CANNOT DO</Text>
        <Muted style={{ marginTop: space.sm }}>
          This is a chest camera twenty metres from the stumps. It is useful for front-foot
          no-balls, run-outs at the bowler&apos;s end, and obvious errors. It is not ball tracking
          and it will not settle a marginal LBW. Anyone who tells you otherwise is selling
          something.
        </Muted>
      </View>

      <View style={s.actions}>
        {first ? (
          <Button label="I understand" onPress={() => void acknowledge()} />
        ) : (
          <Button label="Back" onPress={() => router.back()} variant="secondary" />
        )}
      </View>
    </Screen>
  );
}

function Point({ heading, body }: { heading: string; body: string }) {
  return (
    <View style={s.point}>
      <Body style={{ fontWeight: '600' }}>{heading}</Body>
      <Muted style={{ marginTop: space.xs }}>{body}</Muted>
    </View>
  );
}

const s = StyleSheet.create({
  head: { paddingTop: space.xl, paddingBottom: space.lg },
  point: { paddingVertical: space.md },
  limits: {
    marginTop: space.lg,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  actions: { marginTop: space.xl },
});
