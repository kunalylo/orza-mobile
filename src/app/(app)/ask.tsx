import { FeaturePlaceholder } from '@/components/FeaturePlaceholder';

/** Ask ÖRZA — placeholder until Phase B3 ships the feature. */
export default function AskOrza() {
  return (
    <FeaturePlaceholder
      eyebrow="Your coach"
      title="Ask ÖRZA"
      subtitle="Chat in English, Hindi or Hinglish."
      icon="mci:chat-processing-outline"
      body="Ask anything about food, habits or your plan — ÖRZA remembers what matters to you and answers in your language."
    />
  );
}
