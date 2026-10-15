/** Region picker: search the Indian states & UTs (plus "Outside India"), or keep a custom place. */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { Icon, Sheet, Text, TextField } from '@/ui';

import { FEATURED_REGIONS, INDIAN_REGIONS, OUTSIDE_INDIA, PROFILE_LIMITS } from './options';

const SORTED = [...INDIAN_REGIONS].sort((a, b) => a.localeCompare(b));

function RegionRow({ label, selected, onPress, icon }: { label: string; selected: boolean; onPress: () => void; icon?: 'map-pin' | 'globe' | 'plus' }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, selected && styles.rowOn, pressed && !selected && styles.rowPressed]}
    >
      <Icon name={icon ?? 'map-pin'} size={16} color={selected ? colors.energyInk : colors.subtle} />
      <Text variant="callout" weight={selected ? 'semibold' : 'regular'} style={styles.flex} numberOfLines={1}>
        {label}
      </Text>
      {selected ? <Icon name="check" size={18} color={colors.coral} /> : null}
    </Pressable>
  );
}

export function RegionSheet({ visible, value, onClose, onSelect }: { visible: boolean; value: string; onClose: () => void; onSelect: (region: string) => void }) {
  const [q, setQ] = useState('');
  const query = q.trim().replace(/\s+/g, ' ');
  const lower = query.toLowerCase();

  const close = () => {
    setQ('');
    onClose();
  };
  const pick = (region: string) => {
    haptics.select();
    onSelect(region);
    close();
  };

  const all = [...SORTED, OUTSIDE_INDIA];
  const matches = lower ? all.filter((r) => r.toLowerCase().includes(lower)) : [];
  const exact = all.some((r) => r.toLowerCase() === lower);
  const tooLong = query.length > PROFILE_LIMITS.region.maxLength;
  const regionIcon = (r: string) => (r === OUTSIDE_INDIA ? 'globe' : 'map-pin');

  return (
    <Sheet visible={visible} onClose={close} eyebrow="Profile" title="Your region" full>
      <TextField
        icon="search"
        value={q}
        onChangeText={setQ}
        placeholder="Search states, UTs or type your city"
        autoCorrect={false}
        autoCapitalize="words"
        returnKeyType="done"
        accessibilityLabel="Search regions"
        error={tooLong ? `Keep it under ${PROFILE_LIMITS.region.maxLength} characters` : null}
        hint="Your state helps ÖRZA suggest familiar dishes."
      />

      <View accessibilityRole="radiogroup" style={styles.list}>
        {lower ? (
          <>
            {matches.map((r) => (
              <RegionRow key={r} label={r} icon={regionIcon(r)} selected={r === value} onPress={() => pick(r)} />
            ))}
            {!exact && !tooLong ? <RegionRow label={`Use “${query}”`} icon="plus" selected={false} onPress={() => pick(query)} /> : null}
          </>
        ) : (
          <>
            {value && !all.includes(value) ? <RegionRow label={value} selected onPress={() => pick(value)} /> : null}
            <Text variant="eyebrow" tone="subtle" style={styles.heading}>
              Popular
            </Text>
            {FEATURED_REGIONS.map((r) => (
              <RegionRow key={`f-${r}`} label={r} icon={regionIcon(r)} selected={r === value} onPress={() => pick(r)} />
            ))}
            <Text variant="eyebrow" tone="subtle" style={styles.heading}>
              All states & union territories
            </Text>
            {SORTED.map((r) => (
              <RegionRow key={r} label={r} selected={r === value} onPress={() => pick(r)} />
            ))}
          </>
        )}
        {value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear region"
            onPress={() => pick('')}
            style={({ pressed }) => [styles.clear, pressed && styles.rowPressed]}
          >
            <Icon name="x-circle" size={16} color={colors.muted} />
            <Text variant="label" tone="muted">
              Clear region
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  list: { marginTop: spacing.md, gap: 2 },
  heading: { marginTop: spacing.lg, marginBottom: spacing.xs, marginLeft: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radii.sm },
  rowOn: { backgroundColor: colors.energyBg },
  rowPressed: { backgroundColor: 'rgba(20,20,20,0.04)' },
  clear: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: 48, marginTop: spacing.lg, borderRadius: radii.sm },
});
