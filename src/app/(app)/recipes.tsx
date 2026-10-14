import { FeaturePlaceholder } from '@/components/FeaturePlaceholder';

/** Recipes — placeholder until Phase B3 ships the feature. */
export default function Recipes() {
  return (
    <FeaturePlaceholder
      eyebrow="Cook smarter"
      title="Recipes"
      subtitle="Dishes that fit your diet, region and targets."
      icon="mci:chef-hat"
      body="Find recipes for your diet and region, with nutrition per serving and swaps that keep the taste."
    />
  );
}
