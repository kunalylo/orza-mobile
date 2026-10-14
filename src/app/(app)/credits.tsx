import { FeaturePlaceholder } from '@/components/FeaturePlaceholder';

/** AI credits — placeholder until Phase B3 ships the feature. */
export default function Credits() {
  return (
    <FeaturePlaceholder
      eyebrow="Account"
      title="AI credits"
      subtitle="What powers snaps, chats and scans."
      icon="mci:lightning-bolt-outline"
      body="See your credit balance and history, and request a top-up when you're running low."
    />
  );
}
