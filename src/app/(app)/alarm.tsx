import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { Button, Orb, Screen, ScreenHeader, Text, goBackOrHome } from '@/ui';

/**
 * Full-screen medicine alarm (placeholder). Phase C replaces it with the photo alarm:
 * the medicine photo, dose, Take / Snooze / Skip (→ POST /api/meds/doses), sound + vibration.
 */
export default function Alarm() {
  return (
    <Screen backdrop="hero" scroll={false}>
      <StatusBar style="light" />
      <ScreenHeader back backIcon="close" tone="hero" eyebrow="Medicine alarm" title="Time for your dose" large={false} />
      <View style={styles.center}>
        <Orb size={220} tone="dark" active />
        <Text variant="callout" tone="heroMuted" align="center" style={styles.body}>
          Photo alarms with Take, Snooze and Skip arrive in the next build step.
        </Text>
      </View>
      <Button label="Close" variant="heroOutline" size="lg" block onPress={goBackOrHome} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { marginTop: spacing.xxl, maxWidth: 300 },
});
