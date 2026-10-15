/** "Cooking for you" — what every recipe is tuned to (diet, allergies, region, calorie budget). */
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatNumber } from '@/features/chat/format';
import type { PublicUser } from '@/lib/types';
import { colors, radii, spacing } from '@/theme';
import { Icon, Text, type IconName } from '@/ui';

import { DarkPanel } from './DarkPanel';
import { DIET_LABELS, type KitchenPrefs } from './types';

export function KitchenCard({ user, kitchen }: { user: PublicUser; kitchen?: KitchenPrefs | null }) {
  const p = user.profile ?? {};
  const diets = kitchen?.diets ?? (p.diet ? [p.diet] : []);
  const avoid = (kitchen?.avoid ?? p.allergies ?? []).filter((a) => a && !/^(none|no|nil)$/i.test(a.trim()));
  const daily = user.targets?.calories || 2000;
  const perMeal = Math.round((daily * 0.3) / 10) * 10;
  const rows: { icon: IconName; label: string; value: string }[] = [
    { icon: 'mci:leaf', label: 'Diet', value: diets.length ? diets.map((d) => DIET_LABELS[d]).join(' · ') : 'No restriction set' },
    { icon: 'shield', label: 'Always avoiding', value: avoid.length ? avoid.join(', ') : 'No allergies on file' },
    { icon: 'map-pin', label: 'Home kitchen', value: p.region || 'Across India' },
    { icon: 'mci:fire', label: 'Calorie budget', value: `${formatNumber(daily)} kcal a day · about ${formatNumber(perMeal)} per main meal` },
  ];
  return (
    <DarkPanel>
      <Text variant="eyebrow" tone="heroSubtle">
        Cooking for you
      </Text>
      <Text variant="h2" tone="inverse" style={styles.title}>
        Every recipe is tuned to your plate.
      </Text>
      <View style={styles.rows}>
        {rows.map((r) => (
          <View key={r.label} style={styles.row} accessible accessibilityLabel={`${r.label}: ${r.value}`}>
            <View style={styles.disc}>
              <Icon name={r.icon} size={16} color={colors.amber} />
            </View>
            <View style={styles.rowText}>
              <Text variant="eyebrow" tone="heroSubtle" style={styles.label}>
                {r.label}
              </Text>
              <Text variant="small" color="rgba(247,244,239,0.9)">
                {r.value}
              </Text>
            </View>
          </View>
        ))}
      </View>
      <Pressable onPress={() => router.push('/account/profile')} style={styles.link} accessibilityRole="link" hitSlop={6}>
        <Text variant="caption" color="rgba(247,244,239,0.85)" weight="medium">
          Update preferences
        </Text>
        <Icon name="arrow-up-right" size={14} color="rgba(247,244,239,0.85)" />
      </Pressable>
    </DarkPanel>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: spacing.sm, maxWidth: 260 },
  rows: { gap: spacing.lg, marginTop: spacing.xl },
  row: { flexDirection: 'row', gap: spacing.md },
  disc: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  rowText: { flex: 1, gap: 2 },
  label: { fontSize: 10 },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: spacing.xl,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
});
