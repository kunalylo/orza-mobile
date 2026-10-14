import { FeaturePlaceholder } from '@/components/FeaturePlaceholder';

/** Meals — the food log (B1: text / voice / food list, edit, history). */
export default function Meals() {
  return (
    <FeaturePlaceholder
      tab
      eyebrow="Food log"
      title="Meals"
      subtitle="Everything you've eaten, in your own words."
      icon="mci:silverware-fork-knife"
      body="Log a meal by typing, speaking or picking from Indian favourites — ÖRZA works out the nutrition and keeps your day on track."
    />
  );
}
