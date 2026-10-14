import { FeaturePlaceholder } from '@/components/FeaturePlaceholder';

/** Medicines — schedules, photos, stock, prescription scan, adherence (B2). */
export default function Medicines() {
  return (
    <FeaturePlaceholder
      tab
      eyebrow="Care"
      title="Medicines"
      subtitle="Every dose on time, with a photo of the right pill."
      icon="mci:pill"
      body="Add medicines with photos, scan a prescription into alarms, track stock and refills, and see how well you're keeping up."
    />
  );
}
