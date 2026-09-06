import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { space } from '@/theme/spacing';
import { type } from '@/theme/typography';
import type { Decision } from '@/types/protocol';

import { Choice } from './ui';

/**
 * Three buttons, written straight to the reviews table.
 *
 * This is not paperwork. The decision log is what a league looks at after a
 * season, and it is the artefact that justifies the system existing at all: it
 * is the only thing that survives when the video does not.
 */
export function DecisionBar({
  value,
  onChange,
}: {
  value: Decision | null;
  onChange: (d: Decision) => void;
}) {
  return (
    <View style={s.wrap}>
      <Text style={[type.captionStrong, { color: colors.textMuted, marginBottom: space.sm }]}>
        MARK THE DECISION
      </Text>
      <Choice<Decision>
        size="lg"
        value={value}
        onChange={onChange}
        options={[
          { value: 'out', label: 'Out' },
          { value: 'not_out', label: 'Not out' },
          { value: 'inconclusive', label: 'Unclear' },
        ]}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: space.xl, paddingTop: space.lg },
});
