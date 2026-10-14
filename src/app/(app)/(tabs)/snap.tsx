import { FeaturePlaceholder } from '@/components/FeaturePlaceholder';

/** Snap & Know — camera / gallery → AI meal scan → edit → log (B1). */
export default function Snap() {
  return (
    <FeaturePlaceholder
      tab
      eyebrow="Snap & know"
      title="Snap a meal"
      subtitle="Point, shoot, and ÖRZA recognises your food."
      icon="mci:camera-iris"
      body="Take a photo or pick one from your gallery — ÖRZA identifies each dish, estimates portions and nutrition, and lets you fix anything before logging."
    />
  );
}
