import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Screen } from '@/ui/Screen';
import { EmptyState } from '@/ui/EmptyState';

/** Unknown deep link (orza://…) — send people home. */
export default function NotFound() {
  return (
    <Screen backdrop="orb" scroll={false} contentContainerStyle={styles.center}>
      <EmptyState
        eyebrow="Not found"
        title="This page wandered off"
        body="The link may be old or mistyped."
        actionLabel="Go home"
        actionVariant="primary"
        onAction={() => router.replace('/')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { justifyContent: 'center' },
});
