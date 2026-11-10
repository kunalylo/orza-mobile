/**
 * After Not now (or on an old server): why the feature waits and what still works (`aiConsent.declinedLine`), with
 * "Allow AI features" to be asked again. Renders nothing until the gate said no for `feature`, and nothing once the
 * member's copy has a recorded consent (`useAiDeclined`).
 */
import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { ALLOW_AI_LABEL, AI_UNAVAILABLE, declinedLine, type AiFeature } from '@/lib/aiConsent';
import { colors, radii, spacing } from '@/theme';
import { Button, Icon, Text } from '@/ui';

import { ensureAiConsent, useAiDeclined } from './consent';

export function AiDeclinedNote({ feature, style }: { feature: AiFeature; style?: StyleProp<ViewStyle> }) {
  const { declined, unavailable } = useAiDeclined(feature);
  const [asking, setAsking] = useState(false);
  if (!declined && !unavailable) return null;

  const ask = () => {
    if (asking) return;
    setAsking(true);
    void ensureAiConsent(feature).finally(() => setAsking(false));
  };

  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} style={[styles.note, style]} accessibilityLiveRegion="polite">
      <Icon name="mci:creation" size={16} color={colors.cyan700} />
      <View style={styles.body}>
        <Text variant="small" tone="text">
          {unavailable ? AI_UNAVAILABLE : declinedLine(feature)}
        </Text>
        {declined ? (
          <Button
            label={ALLOW_AI_LABEL}
            icon="check"
            size="sm"
            variant="secondary"
            loading={asking}
            onPress={ask}
            accessibilityHint="Shows what ÖRZA’s AI features send to OpenAI, with Allow"
            style={styles.button}
          />
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.infoBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(11,143,166,0.22)',
  },
  body: { flex: 1, minWidth: 0, gap: spacing.sm },
  button: { alignSelf: 'flex-start' },
});
