import { StyleSheet, View } from 'react-native';

import { FeaturePlaceholder } from '@/components/FeaturePlaceholder';
import { firstName, useSignedInUser } from '@/lib/auth';
import { Orb } from '@/ui';

function greeting(now: Date) {
  const h = now.getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Today — the daily dashboard (B1 fills it: energy rings, meals, water, today's medicines). */
export default function Today() {
  const user = useSignedInUser();
  const now = new Date();
  const date = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <FeaturePlaceholder
      tab
      eyebrow={date}
      title={`${greeting(now)}, ${firstName(user)}`}
      subtitle="Your day at a glance — energy, meals, water and medicines."
      cardTitle="Your day is on its way"
      body="Your daily rings for calories, protein and water, today's meals and medicines, and a gentle nudge from ÖRZA will live here."
      decoration={
        <View style={styles.orb} pointerEvents="none">
          <Orb size={150} tone="light" />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  orb: { position: 'absolute', top: -48, right: -62, opacity: 0.85 },
});
