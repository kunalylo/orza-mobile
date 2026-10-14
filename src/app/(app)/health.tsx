import { FeaturePlaceholder } from '@/components/FeaturePlaceholder';

/** Health sync — placeholder until Phase B4 ships the feature. */
export default function HealthSync() {
  return (
    <FeaturePlaceholder
      eyebrow="Connections"
      title="Health sync"
      subtitle="Steps, sleep and heart rate from your phone."
      icon="mci:heart-pulse"
      body="Connect Apple Health or Health Connect so your activity and sleep shape your targets and reports."
    />
  );
}
