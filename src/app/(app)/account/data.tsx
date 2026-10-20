/**
 * Settings → Privacy & data ("Your data, your call"): export everything as JSON (saved to the cache folder, then the
 * share sheet — Save to Files / Drive / email), privacy links, and Delete account (type DELETE to confirm →
 * DELETE /api/account → sign this phone out). `?confirm=delete` opens the delete sheet straight away.
 */
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';

import { exportMyData, formatBytes, useDeleteAccount, type ExportResult } from '@/features/settings/api';
import { DELETE_WORD, WHAT_GETS_DELETED } from '@/features/settings/options';
import { Note, SettingsGroup, SettingsRow, TINTS } from '@/features/settings/parts';
import { useAuth } from '@/lib/auth';
import { WEB_URL } from '@/lib/config';
import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { Button, GlassCard, Icon, Screen, ScreenHeader, Sheet, Text, TextField, toast } from '@/ui';

function DeleteAccountSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { signOut } = useAuth();
  const del = useDeleteAccount();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const deleting = del.isPending || del.isSuccess;
  const ready = typed.trim() === DELETE_WORD;

  const close = () => {
    if (deleting) return;
    setTyped('');
    setError(null);
    onClose();
  };

  const submit = () => {
    if (!ready || deleting) return;
    haptics.firm();
    setError(null);
    del.mutate(undefined, {
      onSuccess: () => {
        haptics.success();
        toast.success('Your account has been deleted. Thank you for trying ÖRZA. Take care.', 5000);
        void signOut();
      },
      onError: (e) => {
        haptics.error();
        setError(e instanceof Error && e.message ? e.message : "We couldn't delete your account. Please try again.");
      },
    });
  };

  return (
    <Sheet
      visible={visible}
      onClose={close}
      dismissible={!deleting}
      eyebrow="Danger zone"
      title="Delete your account?"
      footer={
        <View style={styles.sheetFooter}>
          <Button label="Keep my account" variant="ghost" onPress={close} disabled={deleting} style={styles.flex} />
          <Button label="Delete forever" variant="danger" icon="trash-2" onPress={submit} loading={deleting} disabled={!ready} style={styles.flex} />
        </View>
      }
    >
      <Text variant="callout" tone="muted">
        This permanently removes your ÖRZA account. It can’t be undone.
      </Text>
      <View style={styles.deleteList} accessibilityLabel="What gets deleted">
        {WHAT_GETS_DELETED.map((item) => (
          <View key={item} style={styles.deleteItem}>
            <View style={styles.redDot} />
            <Text variant="small" tone="ink" style={styles.flex}>
              {item}
            </Text>
          </View>
        ))}
      </View>
      <Text variant="small" tone="muted" style={styles.copyFirst}>
        Want a copy first? Close this and use “Export my data”.
      </Text>
      <TextField
        label={`Type ${DELETE_WORD} to confirm`}
        value={typed}
        onChangeText={(v) => {
          setTyped(v);
          if (error) setError(null);
        }}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        placeholder={DELETE_WORD}
        returnKeyType="done"
        onSubmitEditing={submit}
        editable={!deleting}
        containerStyle={styles.confirm}
      />
      {error ? (
        <Animated.View entering={FadeIn.duration(180)} accessibilityLiveRegion="assertive" style={styles.error}>
          <Note icon="alert-circle" tint={TINTS.danger}>
            <Text variant="small" color={colors.error}>
              {error}
            </Text>
          </Note>
        </Animated.View>
      ) : null}
    </Sheet>
  );
}

export default function DataSettings() {
  const params = useLocalSearchParams<{ confirm?: string }>();
  const [deleteOpen, setDeleteOpen] = useState(params.confirm === 'delete');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<ExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const onExport = async () => {
    if (exporting) return;
    haptics.tap();
    setExporting(true);
    setExportError(null);
    try {
      const res = await exportMyData();
      haptics.success();
      setExported(res);
    } catch (e) {
      haptics.error();
      setExportError(e instanceof Error && e.message ? e.message : "We couldn't prepare your data. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const openWeb = (path: string) => {
    void WebBrowser.openBrowserAsync(`${WEB_URL}${path}`, { toolbarColor: colors.canvas, controlsColor: colors.energyInk }).catch(() =>
      toast.error("Couldn't open the page. Please try again.")
    );
  };

  return (
    <Screen backdrop="orb">
      <ScreenHeader
        back
        large={false}
        eyebrow="Privacy & data"
        title="Your data, your call"
        subtitle="Your data is stored securely. We never share personal health information without your consent."
      />

      <Animated.View entering={FadeInDown.springify().damping(18).stiffness(100).mass(1)}>
        <GlassCard tone="strong" glow padding={spacing.lg} style={styles.card}>
          <View style={styles.cardHead}>
            <View style={[styles.cardIcon, { backgroundColor: colors.cyan50 }]}>
              <Icon name="download" size={20} color={colors.cyan700} />
            </View>
            <Text variant="h3" style={styles.flex}>
              Export my data
            </Text>
          </View>
          <Text variant="small" tone="muted">
            Download everything ÖRZA stores about you — profile, meals, chats, goals, recipes, medicines, reminders, health data and credit history — as a JSON file.
          </Text>
          <Button
            label={exporting ? 'Preparing your data…' : 'Export my data'}
            icon="download"
            variant="secondary"
            loading={exporting}
            onPress={() => void onExport()}
            accessibilityHint="Prepares a JSON file and opens the share sheet so you can save or send it"
            style={styles.cardBtn}
          />
          {exported ? (
            <Animated.View entering={FadeInDown.springify().damping(18).stiffness(100).mass(1)} exiting={FadeOut.duration(150)}>
              <Note icon="check-circle" tint={TINTS.success}>
                {exported.status === 'shared'
                  ? `Your data is ready (${formatBytes(exported.bytes)}). Export again any time.`
                  : `Saved on this phone (${formatBytes(exported.bytes)}), but sharing isn't available here.`}
              </Note>
            </Animated.View>
          ) : null}
          {exportError ? (
            <Animated.View entering={FadeIn.duration(180)} accessibilityLiveRegion="polite">
              <Note icon="alert-circle" tint={TINTS.danger}>
                <Text variant="small" color={colors.error}>
                  {exportError}
                </Text>
              </Note>
            </Animated.View>
          ) : null}
        </GlassCard>
      </Animated.View>

      <SettingsGroup title="Policies" delay={70}>
        <SettingsRow
          icon="shield"
          tint={TINTS.cyan}
          title="Privacy policy"
          subtitle="What we collect and how it's used"
          chevron={false}
          trailing={<Icon name="arrow-up-right" size={16} color={colors.subtle} />}
          onPress={() => openWeb('/privacy')}
        />
        <SettingsRow
          icon="mci:shield-check-outline"
          tint={TINTS.cyan}
          title="Trust & safety"
          subtitle="How ÖRZA keeps you and your data safe"
          chevron={false}
          trailing={<Icon name="arrow-up-right" size={16} color={colors.subtle} />}
          onPress={() => openWeb('/trust')}
          last
        />
      </SettingsGroup>

      <Animated.View entering={FadeInDown.delay(140).springify().damping(18).stiffness(100).mass(1)} style={styles.danger}>
        <Text variant="eyebrow" tone="subtle" style={styles.dangerTitle}>
          Danger zone
        </Text>
        <View style={styles.dangerCard}>
          <View style={styles.cardHead}>
            <View style={[styles.cardIcon, { backgroundColor: colors.white }]}>
              <Icon name="alert-triangle" size={19} color={colors.error} />
            </View>
            <Text variant="title" color={colors.error} style={styles.flex}>
              Delete account
            </Text>
          </View>
          <Text variant="small" tone="muted">
            Permanently delete your account and all of your data. This can’t be undone.
          </Text>
          <Button
            label="Delete account…"
            variant="danger"
            onPress={() => {
              haptics.warning();
              setDeleteOpen(true);
            }}
            style={styles.cardBtn}
          />
        </View>
      </Animated.View>

      <DeleteAccountSheet visible={deleteOpen} onClose={() => setDeleteOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  card: { gap: spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardIcon: { width: 40, height: 40, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  cardBtn: { alignSelf: 'flex-start' },
  danger: { marginTop: spacing.xxl },
  dangerTitle: { marginBottom: spacing.sm, marginLeft: spacing.xs },
  dangerCard: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: 'rgba(176,44,44,0.22)',
    backgroundColor: 'rgba(253,236,236,0.6)',
  },
  sheetFooter: { flexDirection: 'row', gap: spacing.sm },
  deleteList: {
    marginTop: spacing.lg,
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'rgba(176,44,44,0.18)',
    backgroundColor: 'rgba(253,236,236,0.6)',
  },
  deleteItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  redDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7, backgroundColor: colors.error },
  copyFirst: { marginTop: spacing.md },
  confirm: { marginTop: spacing.lg },
  error: { marginTop: spacing.md },
});
