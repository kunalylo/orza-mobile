import { FeaturePlaceholder } from '@/components/FeaturePlaceholder';

/** Settings — placeholder until Phase B3 ships the feature. */
export default function Settings() {
  return (
    <FeaturePlaceholder
      eyebrow="Account"
      title="Settings"
      subtitle="Profile, targets, privacy and your data."
      icon="mci:cog-outline"
      body="Edit your profile and targets, preferences, what ÖRZA remembers, your password, and export or delete your data."
    />
  );
}
