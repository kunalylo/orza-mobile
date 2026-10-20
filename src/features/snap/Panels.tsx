/**
 * Snap & Know side panels — tips, analysing skeleton, problem states (AI off, no credits, slow down, permission, error)
 * and the logged confirmation. Wording follows the web's `ScanPanels.tsx`.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { colors, radii, spacing } from '@/theme';
import { Button, GlassCard, Icon, Skeleton, Text, type IconName } from '@/ui';

import type { Meal } from '@/features/meals/types';
import { MEAL_LABEL, formatNumber, round } from '@/features/meals/utils';

import { SNAP_TIPS } from './utils';

type Tone = 'energy' | 'cyan' | 'violet' | 'neutral' | 'success';

const TILE: Record<Tone, { bg: string; fg: string }> = {
  energy: { bg: colors.energyBg, fg: colors.energyInk },
  cyan: { bg: colors.cyan50, fg: colors.cyan700 },
  violet: { bg: colors.violet50, fg: colors.violet600 },
  neutral: { bg: 'rgba(20,20,20,0.05)', fg: colors.muted },
  success: { bg: colors.successBg, fg: colors.success },
};

export function IconTile({ icon, tone, size = 40 }: { icon: IconName; tone: Tone; size?: number }) {
  const t = TILE[tone];
  return (
    <View style={[styles.tile, { width: size, height: size, backgroundColor: t.bg }]}>
      <Icon name={icon} size={Math.round(size * 0.44)} color={t.fg} />
    </View>
  );
}

/* ───────────────────────────── Tips ───────────────────────────── */

export function SnapTips({ scanCost }: { scanCost: number }) {
  return (
    <GlassCard tone="strong">
      <Text variant="eyebrow" tone="subtle">
        For the best estimate
      </Text>
      <Text variant="h3" tone="ink" style={styles.title} accessibilityRole="header">
        Snap tips
      </Text>
      <View style={styles.tips}>
        {SNAP_TIPS.map((tip) => (
          <View key={tip.title} style={styles.tip}>
            <IconTile icon={tip.icon} tone="cyan" size={36} />
            <View style={styles.flex}>
              <Text variant="label" tone="ink">
                {tip.title}
              </Text>
              <Text variant="caption" tone="muted" style={styles.tipBody}>
                {tip.body}
              </Text>
            </View>
          </View>
        ))}
      </View>
      <View style={styles.fine}>
        <View style={styles.fineRow}>
          <Icon name="zap" size={13} color={colors.coral} />
          <Text variant="caption" tone="muted" style={styles.flex}>
            Each scan uses {scanCost} AI credits — refunded automatically if ÖRZA can&apos;t read the photo. Typing or speaking your meal is cheaper, and the
            food list is free.
          </Text>
        </View>
        <View style={styles.fineRow}>
          <Icon name="shield" size={13} color={colors.success} />
          <Text variant="caption" tone="muted" style={styles.flex}>
            Your photo is resized on your phone and used only for this analysis — ÖRZA doesn&apos;t keep it.
          </Text>
        </View>
      </View>
    </GlassCard>
  );
}

/* ───────────────────────────── Analysing ───────────────────────────── */

export function AnalysingPanel() {
  return (
    <GlassCard tone="strong" accessibilityLabel="ÖRZA is analysing your photo" accessible>
      <View style={styles.eyebrowRow}>
        <Icon name="star" size={12} color={colors.cyan600} />
        <Text variant="eyebrow" tone="subtle">
          ÖRZA analysis
        </Text>
      </View>
      <Skeleton height={26} width="75%" style={styles.sk1} />
      <Skeleton height={22} width={130} radius={radii.pill} style={styles.sk2} />
      <View style={styles.skGrid}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={54} style={styles.flex} />
        ))}
      </View>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} height={84} style={styles.skRow} />
      ))}
    </GlassCard>
  );
}

/* ───────────────────────────── Status panels ───────────────────────────── */

function StatusPanel({
  icon,
  tone,
  eyebrow,
  title,
  children,
  actions,
}: {
  icon: IconName;
  tone: Tone;
  eyebrow: string;
  title: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <Animated.View entering={reduce ? undefined : FadeInDown.springify().damping(18).stiffness(100).mass(1)}>
      <GlassCard tone="strong" glow>
        <IconTile icon={icon} tone={tone} />
        <Text variant="eyebrow" tone="subtle" style={styles.eyebrow}>
          {eyebrow}
        </Text>
        <Text variant="h3" tone="ink" style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <View style={styles.body} accessibilityLiveRegion="polite">
          {children}
        </View>
        <View style={styles.actions}>{actions}</View>
      </GlassCard>
    </Animated.View>
  );
}

const P = ({ children, small }: { children: ReactNode; small?: boolean }) => (
  <Text variant={small ? 'caption' : 'small'} tone="muted">
    {children}
  </Text>
);

export function AiDisabledPanel({ message, onTypeInstead }: { message?: string; onTypeInstead: () => void }) {
  return (
    <StatusPanel
      icon="wifi-off"
      tone="neutral"
      eyebrow="Snap & Know"
      title="Photo scanning isn't available right now"
      actions={<Button label="Type or speak your meal" icon="mic" onPress={onTypeInstead} block />}
    >
      <P>{message || "Photo scanning isn't available right now. You can type or speak your meal instead."}</P>
      <P>The meal log understands English, Hindi and Hinglish — “do roti, ek katori dal” works — and the food list is always free.</P>
    </StatusPanel>
  );
}

export function NoCreditsPanel({ onCredits, onLogFree, onRetry }: { onCredits: () => void; onLogFree: () => void; onRetry?: () => void }) {
  return (
    <StatusPanel
      icon="zap"
      tone="energy"
      eyebrow="AI credits"
      title="You're out of AI credits"
      actions={
        <>
          <Button label="Get more credits" iconRight="arrow-up-right" onPress={onCredits} block />
          <View style={styles.row}>
            <Button label="Log it for free" variant="secondary" onPress={onLogFree} style={styles.grow} />
            {onRetry ? <Button label="Try again" icon="rotate-cw" variant="ghost" onPress={onRetry} style={styles.grow} /> : null}
          </View>
        </>
      }
    >
      <P>Photo scans use AI credits. Top up to keep snapping — or log this meal from the food list, which never uses credits.</P>
    </StatusPanel>
  );
}

export function SlowDownPanel({ message, onRetry, onTypeInstead }: { message: string; onRetry?: () => void; onTypeInstead: () => void }) {
  return (
    <StatusPanel
      icon="clock"
      tone="violet"
      eyebrow="One moment"
      title="Let's take a short breather"
      actions={
        <View style={styles.row}>
          {onRetry ? <Button label="Try again" icon="rotate-cw" onPress={onRetry} style={styles.grow} /> : null}
          <Button label="Type it instead" variant="secondary" onPress={onTypeInstead} style={styles.grow} />
        </View>
      }
    >
      <P>{message}</P>
    </StatusPanel>
  );
}

export function PermissionPanel({
  message,
  blocked,
  source,
  onOpenSettings,
  onTryAgain,
  onOtherSource,
}: {
  message: string;
  blocked: boolean;
  source: 'camera' | 'library';
  onOpenSettings: () => void;
  onTryAgain: () => void;
  onOtherSource: () => void;
}) {
  return (
    <StatusPanel
      icon={source === 'camera' ? 'camera-off' : 'image'}
      tone="violet"
      eyebrow={source === 'camera' ? 'Camera access' : 'Photo access'}
      title={source === 'camera' ? 'ÖRZA needs your camera' : 'ÖRZA needs your photos'}
      actions={
        <>
          {blocked ? (
            <Button label="Open Settings" icon="settings" onPress={onOpenSettings} block />
          ) : (
            <Button label="Allow access" icon="unlock" onPress={onTryAgain} block />
          )}
          <Button
            label={source === 'camera' ? 'Choose from gallery instead' : 'Take a photo instead'}
            icon={source === 'camera' ? 'image' : 'camera'}
            variant="secondary"
            onPress={onOtherSource}
            block
          />
        </>
      }
    >
      <P>{message}</P>
      <P small>Photos are only used to estimate your meal — ÖRZA never keeps them.</P>
    </StatusPanel>
  );
}

export function ScanErrorPanel({ message, onRetry, onPickAnother }: { message: string; onRetry?: () => void; onPickAnother: () => void }) {
  return (
    <StatusPanel
      icon="alert-circle"
      tone="violet"
      eyebrow="Couldn't finish the scan"
      title="Let's try that again"
      actions={
        <View style={styles.row}>
          {onRetry ? <Button label="Try again" icon="rotate-cw" onPress={onRetry} style={styles.grow} /> : null}
          <Button label="Use another photo" icon="camera" variant={onRetry ? 'secondary' : 'primary'} onPress={onPickAnother} style={styles.grow} />
        </View>
      }
    >
      <P>{message}</P>
      <P small>When a scan can&apos;t be completed, its credits are refunded automatically.</P>
    </StatusPanel>
  );
}

export function LoggedPanel({ meal, onViewLog, onScanAnother }: { meal: Meal; onViewLog: () => void; onScanAnother: () => void }) {
  const t = meal.totals;
  const n = meal.items.length;
  return (
    <StatusPanel
      icon="check-circle"
      tone="success"
      eyebrow="Logged"
      title={`Added to ${MEAL_LABEL[meal.meal_type].toLowerCase()}`}
      actions={
        <View style={styles.row}>
          <Button label="View meal log" iconRight="arrow-up-right" onPress={onViewLog} style={styles.grow} />
          <Button label="Scan another" icon="camera" variant="secondary" onPress={onScanAnother} style={styles.grow} />
        </View>
      }
    >
      <Text variant="small" tone="muted">
        <Text variant="small" weight="semibold" tone="ink">
          {meal.description}
        </Text>{' '}
        — {n} item{n === 1 ? '' : 's'},{' '}
        <Text variant="small" weight="semibold" tone="ink">
          {formatNumber(t.calories)} kcal
        </Text>
        .
      </Text>
      <Text variant="mono" tone="subtle">
        P {round(t.protein_g, 1)}g · C {round(t.carbs_g, 1)}g · F {round(t.fat_g, 1)}g · Fibre {round(t.fiber_g, 1)}g
      </Text>
    </StatusPanel>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  /** Buttons sharing a row: equal when both labels fit, otherwise the row wraps (no "Use another p…"). */
  grow: { flexGrow: 1 },
  tile: { borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: spacing.xs },
  eyebrow: { marginTop: spacing.lg },
  tips: { marginTop: spacing.lg, gap: spacing.lg },
  tip: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  tipBody: { marginTop: 2 },
  fine: { marginTop: spacing.xl, paddingTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline, gap: spacing.sm },
  fineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sk1: { marginTop: spacing.md },
  sk2: { marginTop: spacing.md },
  skGrid: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  skRow: { marginTop: spacing.md },
  body: { marginTop: spacing.sm, gap: spacing.sm },
  actions: { marginTop: spacing.xl, gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
