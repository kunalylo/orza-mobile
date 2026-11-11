/**
 * "Report" on an AI output the member was shown (`docs/notes/ai-report.md` §5, §8): opens the Report sheet
 * (`AiReportHost`). After a report this visit it says "Reported" with a filled flag and still opens the sheet, since
 * reporting again replaces the earlier report.
 * `look="quiet"`: the small flag and word under an Ask ÖRZA reply or in a card's corner (36 dp, 48 with its slop).
 * `look="button"`: a small ghost button in an action row.
 */
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { REPORT_COPY, reportTriggerLabel, type AiReportKind } from '@/lib/aiReport';
import { haptics } from '@/lib/haptics';
import { colors, radii } from '@/theme';
import { Button, Icon, Text } from '@/ui';

import { openAiReport, useAiReported } from './report';

/** 36 dp tall: 4 dp above (the reply's bubble is 4 dp up) and 8 below make the 48 dp target. */
const QUIET_SLOP = { top: 4, bottom: 8, left: 6, right: 6 };

export function ReportAiButton({
  kind,
  refId,
  look = 'quiet',
  style,
}: {
  kind: AiReportKind;
  refId: string;
  look?: 'quiet' | 'button';
  style?: StyleProp<ViewStyle>;
}) {
  const reported = useAiReported(kind, refId);
  const label = reportTriggerLabel(kind, reported);
  const text = reported ? REPORT_COPY.reported : REPORT_COPY.trigger;
  const icon = reported ? 'mci:flag' : 'mci:flag-outline';
  const open = () => openAiReport(kind, refId);

  if (look === 'button') {
    return <Button label={text} icon={icon} variant="ghost" size="sm" onPress={open} accessibilityLabel={label} style={style} />;
  }
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        open();
      }}
      hitSlop={QUIET_SLOP}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.quiet, pressed && styles.pressed, style]}
    >
      <Icon name={icon} size={14} color={colors.subtle} />
      <Text variant="caption" tone="subtle">
        {text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  quiet: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
  },
  pressed: { backgroundColor: 'rgba(20,20,20,0.05)' },
});
