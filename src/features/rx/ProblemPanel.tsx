/** Why a scan didn't work, with the way forward: type the medicines, get credits, or try again. */
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';

import { colors, radii, spacing } from '@/theme';
import { Button, Icon, Text, type IconName } from '@/ui';

import type { RxProblem } from './problem';

const ICON: Record<RxProblem['kind'], IconName> = {
  ai_disabled: 'mci:robot-off-outline',
  ai_busy: 'mci:timer-sand',
  no_credits: 'mci:circle-multiple-outline',
  rate_limited: 'clock',
  offline: 'wifi-off',
  photo: 'image',
  error: 'alert-triangle',
};

export function ProblemPanel({ problem, onManual, onRetry, retrying }: { problem: RxProblem; onManual: () => void; onRetry?: () => void; retrying?: boolean }) {
  const canRetry = !!onRetry && (problem.kind === 'error' || problem.kind === 'offline' || problem.kind === 'rate_limited' || problem.kind === 'ai_busy');
  return (
    <Animated.View entering={FadeInDown.springify().damping(18)} exiting={FadeOut.duration(160)} style={styles.panel} accessibilityRole="alert">
      <View style={styles.head}>
        <View style={styles.icon}>
          <Icon name={ICON[problem.kind]} size={18} color={colors.warning} />
        </View>
        <View style={styles.flex}>
          <Text variant="title" color="#8A5300">
            {problem.title}
          </Text>
          <Text variant="small" color="#8A5300" style={styles.message}>
            {problem.message}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Button label="Type the medicines instead" icon="edit-3" size="sm" variant="primary" onPress={onManual} />
        {problem.kind === 'no_credits' ? (
          <Button label="Get more credits" icon="plus-circle" size="sm" variant="secondary" onPress={() => router.push('/credits')} />
        ) : null}
        {canRetry ? <Button label="Try again" icon="refresh-cw" size="sm" variant="secondary" onPress={onRetry} loading={retrying} /> : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  panel: {
    padding: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: '#FFF8EE',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(176,106,0,0.28)',
    gap: spacing.md,
  },
  head: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.warningBg,
  },
  message: { marginTop: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
