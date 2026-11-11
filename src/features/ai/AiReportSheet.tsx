/**
 * The Report sheet (`docs/notes/ai-report.md` §5): what's wrong (one reason, none picked at first), an optional note
 * with its counter, Send report / Cancel. `AiReportHost` is mounted once in the member layout and shows it for
 * `openAiReport` (`./report`); another member (or a sign-out) closes it. While the report is on its way nothing
 * dismisses it; a failed send keeps the reason and the note, with the line above the buttons.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ChoiceList } from '@/features/settings/parts';
import { AI_REPORT_NOTE_MAX, REPORT_COPY, REPORT_REASONS, noteCounter, reportHint, reportTitle, type AiReportReason } from '@/lib/aiReport';
import { useAuth } from '@/lib/auth';
import { spacing } from '@/theme';
import { Button, Sheet, Text, TextField } from '@/ui';

import { ConsentError } from './AiConsentSheet';
import { closeAiReport, resetAiReport, sendAiReport, useAiReportPrompt } from './report';

export function AiReportHost() {
  const { user } = useAuth();
  const prompt = useAiReportPrompt();
  const [reason, setReason] = useState<AiReportReason | null>(null);
  const [note, setNote] = useState('');
  // Each open starts blank (the website's dialog does too); a failed send keeps both.
  const [formFor, setFormFor] = useState(prompt.openId);
  if (formFor !== prompt.openId) {
    setFormFor(prompt.openId);
    setReason(null);
    setNote('');
  }

  const id = user?.id ?? null;
  useEffect(() => () => resetAiReport(), [id]);

  const { kind, sending } = prompt;
  const counter = noteCounter(note);
  const hint = reportHint(kind);

  return (
    <Sheet
      visible={prompt.visible && !!user}
      onClose={closeAiReport}
      dismissible={!sending}
      title={reportTitle(kind)}
      footer={
        <View style={styles.footer}>
          <ConsentError message={prompt.error} />
          <Button
            label={REPORT_COPY.send}
            icon="send"
            variant="primary"
            size="lg"
            block
            loading={sending}
            disabled={!reason}
            haptic="firm"
            onPress={() => {
              if (reason) void sendAiReport(reason, note);
            }}
          />
          <Button label={REPORT_COPY.cancel} variant="ghost" block onPress={closeAiReport} disabled={sending} />
        </View>
      }
    >
      <Text variant="callout" tone="text">
        {REPORT_COPY.lead}
      </Text>
      <View style={styles.group}>
        <Text variant="label" tone="text" style={styles.question}>
          {REPORT_COPY.question}
        </Text>
        <ChoiceList label={REPORT_COPY.question} options={REPORT_REASONS} value={reason ?? ''} onChange={setReason} disabled={sending} />
      </View>
      <View>
        <TextField
          label={REPORT_COPY.noteLabel}
          value={note}
          onChangeText={setNote}
          maxLength={AI_REPORT_NOTE_MAX}
          multiline
          textAlignVertical="top"
          editable={!sending}
          inputStyle={styles.note}
          accessibilityHint={hint}
        />
        <View style={styles.under}>
          {/* The field's own hint says it to screen readers (one stop, as the website's aria-describedby). */}
          <Text variant="caption" tone="subtle" style={styles.flex} accessibilityElementsHidden importantForAccessibility="no">
            {hint}
          </Text>
          <Text variant="caption" tone="subtle" style={styles.count} accessibilityLabel={counter.label}>
            {counter.text}
          </Text>
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  group: { marginTop: spacing.xs },
  question: { marginBottom: spacing.sm, marginLeft: 4 },
  note: { minHeight: 88, paddingTop: 14 },
  under: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginTop: spacing.sm, marginHorizontal: 4 },
  count: { fontVariant: ['tabular-nums'] },
  footer: { gap: spacing.xs },
});
