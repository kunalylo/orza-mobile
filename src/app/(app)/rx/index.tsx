import { FeaturePlaceholder } from '@/components/FeaturePlaceholder';

/** TEMPORARY — prescription scan (step B2b replaces this file). Linked from the Medicines tab. */
export default function PrescriptionScan() {
  return (
    <FeaturePlaceholder
      eyebrow="Care · Prescriptions"
      title="Scan a prescription"
      subtitle="Snap it once — ÖRZA sets every alarm for you to review."
      icon="mci:file-document-outline"
      body="Snap your doctor's prescription — ÖRZA reads 1-0-1, BD, TDS, “after food” and “x 5 days”, and sets every alarm for you to review."
    />
  );
}
