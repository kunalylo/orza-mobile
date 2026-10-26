/**
 * The Health screen's connection panel — every state of "is this phone's health store linked to ÖRZA?":
 * checking → unsupported / install Health Connect → connect → connected (sync now, manage, disconnect, errors).
 */
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState, StyleSheet, View, type AppStateStatus } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition, useReducedMotion } from 'react-native-reanimated';

import { WEB_URL } from '@/lib/config';
import { haptics } from '@/lib/haptics';
import type { useHealthSync } from '@/lib/health/sync';
import { colors, radii, spacing } from '@/theme';
import { Button, GlassCard, Icon, Orb, Skeleton, SkeletonText, Tag, Text, toast, type IconName } from '@/ui';

import { timeAgo } from './format';

type Health = ReturnType<typeof useHealthSync>;

const METRICS: { label: string; icon: IconName }[] = [
  { label: 'Steps', icon: 'mci:shoe-print' },
  { label: 'Active energy', icon: 'zap' },
  { label: 'Distance', icon: 'map-pin' },
  { label: 'Sleep', icon: 'moon' },
  { label: 'Heart rate', icon: 'heart' },
  { label: 'Weight', icon: 'mci:scale-bathroom' },
  { label: 'Water', icon: 'droplet' },
];

export function openWebHealth() {
  void WebBrowser.openBrowserAsync(`${WEB_URL}/dashboard/health`, { toolbarColor: colors.canvas, controlsColor: colors.ink }).catch(() => {});
}

export function ConnectCard({ health }: { health: Health }) {
  const reduce = useReducedMotion();
  const { availability, platform, name, connected } = health;

  let body: ReactNode;
  if (availability === 'checking') body = <CheckingState />;
  else if (platform === 'none' || availability === 'unsupported') body = <UnsupportedState health={health} />;
  else if (availability === 'needs_install' || availability === 'needs_update') body = <InstallState health={health} />;
  else if (!connected) body = <ConnectState health={health} />;
  else body = <ConnectedState health={health} />;

  return (
    <Animated.View
      entering={reduce ? undefined : FadeInDown.delay(40).springify().damping(18).stiffness(100).mass(1)}
      layout={reduce ? undefined : LinearTransition.springify().damping(20).stiffness(100).mass(1)}
      accessibilityLabel={`${name} connection`}
    >
      <GlassCard glow={!connected} tone={connected ? 'default' : 'strong'} padding={spacing.xl}>
        {body}
      </GlassCard>
    </Animated.View>
  );
}

/* ───────────────────────────── states ───────────────────────────── */

function CheckingState() {
  return (
    <View style={styles.gap} accessibilityLabel="Checking your phone's health app">
      <Skeleton width={120} height={12} />
      <Skeleton width="70%" height={24} />
      <SkeletonText lines={2} />
      <Skeleton height={48} radius={radii.pill} />
    </View>
  );
}

function UnsupportedState({ health }: { health: Health }) {
  const title =
    health.platform === 'ios'
      ? 'Apple Health isn’t available here'
      : health.platform === 'android'
        ? 'Health Connect isn’t available on this phone'
        : 'Health sync needs the ÖRZA phone app';
  return (
    <View style={styles.gap}>
      <IconDisc icon="mci:heart-off-outline" tone="muted" />
      <Text variant="h3" tone="ink">
        {title}
      </Text>
      <Text variant="small" tone="muted">
        You can still bring your data in from the website — import an Apple Health export, a CSV file, or connect an automation
        app that posts to ÖRZA.
      </Text>
      <Button label="More ways to connect" variant="secondary" icon="external-link" onPress={openWebHealth} block />
    </View>
  );
}

function InstallState({ health }: { health: Health }) {
  const update = health.availability === 'needs_update';
  return (
    <View style={styles.gap}>
      <IconDisc icon="mci:google-play" tone="energy" />
      <Text variant="eyebrow" tone="energy">
        One quick step
      </Text>
      <Text variant="h3" tone="ink">
        {update ? 'Update Health Connect' : 'Get Health Connect'}
      </Text>
      <Text variant="small" tone="muted">
        Health Connect is Google’s free app that keeps steps, sleep and heart rate from your phone, watch and fitness apps in one place.{' '}
        {update ? 'Update it' : 'Install it'} from Google Play, then come back here to connect.
      </Text>
      <Button
        label={update ? 'Update on Google Play' : 'Get it on Google Play'}
        variant="energy"
        icon="download"
        block
        haptic="firm"
        onPress={() => void health.openStore()}
      />
      <Button label="I’ve installed it" variant="ghost" icon="refresh-cw" onPress={() => void health.recheck()} />
    </View>
  );
}

function ConnectState({ health }: { health: Health }) {
  const reduce = useReducedMotion();
  // After a "Don't allow" (and for good after the second one, when Android stops showing the sheet), offer ÖRZA's own
  // Health Connect page, and connect by itself when the person comes back having allowed something there.
  const [denied, setDenied] = useState(false);
  const busy = useRef(false);
  const { platform } = health;

  // Back from Health Connect with something allowed: connect without asking again (the sheet would only reappear for
  // the types still off, or not at all).
  useOnReturnWithAccess(denied, health, () => void connect({ onlyIfGranted: true }));

  async function connect(opts?: { onlyIfGranted?: boolean }) {
    if (busy.current) return;
    busy.current = true;
    try {
      await runConnect(opts);
    } finally {
      busy.current = false;
    }
  }

  async function runConnect(opts?: { onlyIfGranted?: boolean }) {
    haptics.firm();
    const r = await health.connect(opts);
    if (r.status === 'denied') {
      if (opts?.onlyIfGranted) return;
      haptics.warning();
      setDenied(true);
      toast.info(
        health.platform === 'android'
          ? 'No permissions were allowed. Allow at least one type in Health Connect to start syncing.'
          : 'Nothing was shared. You can allow ÖRZA any time from the Health app.'
      );
      return;
    }
    if (r.status === 'unavailable') return; // the card switches to the install / unsupported state
    if (r.status === 'error') {
      haptics.error();
      toast.error(r.message);
      return;
    }
    announce(r.outcome, health.name);
  }

  return (
    <View style={styles.gap}>
      <View style={styles.connectHead}>
        <Orb size={64} tone="light" orbits={false} paused={reduce} active={health.connecting} />
        <View style={styles.flex}>
          <Text variant="eyebrow" tone="energy">
            Connect
          </Text>
          <Text variant="h2" tone="ink">
            {`Connect ${health.name}`}
          </Text>
        </View>
      </View>
      <Text variant="callout" tone="text">
        ÖRZA reads your daily totals — never raw samples or locations — so your targets, reports and coaching reflect how you
        really move, sleep and recover.
      </Text>
      <View style={styles.metrics} accessibilityLabel="Read: steps, active energy, distance, sleep, heart rate, weight and water">
        {METRICS.map((m, i) => (
          <Animated.View key={m.label} entering={reduce ? undefined : FadeIn.delay(120 + i * 40)}>
            <Tag label={m.label} icon={m.icon} tone="neutral" />
          </Animated.View>
        ))}
      </View>
      <Button
        label={health.connecting ? 'Connecting…' : `Connect ${health.name}`}
        variant="energy"
        size="lg"
        icon={health.platform === 'ios' ? 'mci:apple' : 'mci:heart-pulse'}
        block
        loading={health.connecting}
        onPress={() => void connect()}
        accessibilityHint={`Opens ${health.name} to choose what ÖRZA can read`}
      />
      {denied && platform === 'android' ? (
        <AllowInHealthConnect health={health}>
          ÖRZA can’t read anything yet. If Health Connect doesn’t ask again, open it › App permissions › ÖRZA and switch on what
          ÖRZA may read — syncing starts as soon as you come back.
        </AllowInHealthConnect>
      ) : (
        <Text variant="caption" tone="subtle" align="center">
          You choose exactly what to share on the next screen, and you can stop syncing any time.
        </Text>
      )}
    </View>
  );
}

function ConnectedState({ health }: { health: Health }) {
  const { record, syncing, name, platform } = health;
  const synced = record.lastSyncAt ? timeAgo(record.lastSyncAt) : '';

  async function syncNow() {
    haptics.tap();
    const r = await health.syncNow();
    if (r.status === 'error') {
      haptics.error();
      toast.error(r.message);
    } else if (r.status === 'synced' || r.status === 'empty') {
      announce(r, name, false);
    }
  }

  // Reconnect after access was switched off. Health Connect won't show its sheet at all while any type ÖRZA asks for was
  // refused twice ("App has at least one USER_FIXED permission, finishing!") — then the way back is ÖRZA's page in
  // Health Connect, and the sync re-runs by itself when the person returns with something allowed.
  const [blocked, setBlocked] = useState(false);
  useOnReturnWithAccess(!!record.needsReconnect, health, () => void syncNow());

  async function reconnect() {
    haptics.firm();
    const r = await health.connect();
    if (r.status === 'connected') {
      setBlocked(false);
      announce(r.outcome, name);
    } else if (r.status === 'denied') {
      haptics.warning();
      setBlocked(true);
      if (platform === 'android') toast.info('Health Connect didn’t allow anything. Switch ÖRZA back on there to keep syncing.');
      else toast.info('Nothing was shared. You can allow ÖRZA any time from the Health app.');
    } else if (r.status === 'error') {
      haptics.error();
      toast.error(r.message);
    }
  }

  function disconnect() {
    haptics.warning();
    Alert.alert(
      `Stop syncing ${name}?`,
      platform === 'android'
        ? 'ÖRZA will stop reading Health Connect on this phone. Days already synced stay in ÖRZA. To remove its access completely, open Health Connect › App permissions › ÖRZA.'
        : 'ÖRZA will stop reading Apple Health on this phone. Days already synced stay in ÖRZA. To remove its access completely, open the Health app › your profile › Apps › ÖRZA.',
      [
        { text: 'Keep syncing', style: 'cancel' },
        {
          text: 'Stop syncing',
          style: 'destructive',
          onPress: () => {
            health.disconnect();
            haptics.success();
            toast.info(`${name} disconnected`);
          },
        },
      ]
    );
  }

  return (
    <View style={styles.gap}>
      <View style={styles.statusRow}>
        <IconDisc icon={platform === 'ios' ? 'mci:apple' : 'mci:heart-pulse'} tone="success" small />
        <View style={styles.flex}>
          <Text variant="label" tone="ink">
            {`Connected to ${name}`}
          </Text>
          <Text variant="caption" tone="muted">
            {syncing ? 'Syncing your last 30 days…' : synced ? `Synced ${synced}` : 'Waiting for the first sync'}
          </Text>
        </View>
        {syncing ? <Tag label="Syncing" tone="info" dot /> : record.lastError ? <Tag label="Needs attention" tone="warning" dot /> : <Tag label="On" tone="success" dot />}
      </View>

      <Text variant="small" tone="muted">
        ÖRZA syncs your last 30 days whenever you open the app — at most every 3 hours — and you can sync now any time.
      </Text>

      {record.lastError ? (
        <Animated.View entering={FadeIn} style={[styles.banner, styles.bannerError]} accessibilityRole="alert">
          <Icon name="alert-circle" size={16} color={colors.error} />
          <Text variant="caption" color={colors.errorInk} style={styles.flex}>
            {record.lastError}
          </Text>
        </Animated.View>
      ) : record.lastEmpty ? (
        <Animated.View entering={FadeIn} style={[styles.banner, styles.bannerInfo]}>
          <Icon name="info" size={16} color={colors.cyan700} />
          <Text variant="caption" tone="text" style={styles.flex}>
            {platform === 'android'
              ? 'Health Connect has nothing for the last 30 days yet. Apps like Google Fit, Samsung Health or your watch’s app need to share with Health Connect first.'
              : 'Nothing came through from Apple Health. If you switched categories off, open Settings › Health › Data Access & Devices › ÖRZA and turn them on.'}
          </Text>
        </Animated.View>
      ) : record.lastDaysSent ? (
        <Text variant="caption" tone="subtle">
          {`Last sync sent ${record.lastDaysSent} ${record.lastDaysSent === 1 ? 'day' : 'days'} of daily totals.`}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {record.needsReconnect ? (
          <Button label="Reconnect" variant="energy" icon="link" onPress={() => void reconnect()} loading={health.connecting} style={styles.flex} />
        ) : (
          <Button
            label={syncing ? 'Syncing…' : 'Sync now'}
            variant="secondary"
            icon="refresh-cw"
            loading={syncing}
            onPress={() => void syncNow()}
            style={styles.flex}
          />
        )}
        <Button label="Manage access" variant="ghost" icon="sliders" onPress={() => void health.openManage()} style={styles.flex} />
      </View>
      {blocked && record.needsReconnect && platform === 'android' ? (
        <AllowInHealthConnect health={health}>
          Health Connect isn’t asking again. Open it › App permissions › ÖRZA and switch on what ÖRZA may read — the sync
          runs again as soon as you come back.
        </AllowInHealthConnect>
      ) : null}
      <Button label="Stop syncing" variant="ghost" icon="x-circle" onPress={disconnect} accessibilityHint={`Stops reading ${name} on this phone`} />
    </View>
  );
}

/* ───────────────────────────── bits ───────────────────────────── */

/**
 * While `enabled`, runs `onAccess` each time the app comes back to the front (from Health Connect's settings) and ÖRZA
 * can read at least one type. Android only — HealthKit never tells an app what was refused.
 */
function useOnReturnWithAccess(enabled: boolean, health: Health, onAccess: () => void) {
  const latest = useRef(onAccess);
  useEffect(() => {
    latest.current = onAccess;
  });
  const { hasAccess, platform } = health;
  useEffect(() => {
    if (!enabled || platform !== 'android') return undefined;
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s !== 'active') return;
      void hasAccess().then((ok) => {
        if (ok) latest.current();
      });
    });
    return () => sub.remove();
  }, [enabled, platform, hasAccess]);
}

/** "Allow ÖRZA in Health Connect" note + a button to its settings — for when Health Connect won't show its sheet. */
function AllowInHealthConnect({ health, children }: { health: Health; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <Animated.View entering={reduce ? undefined : FadeIn} style={[styles.banner, styles.bannerInfo]} accessibilityRole="alert">
      <Icon name="info" size={16} color={colors.cyan700} />
      <View style={[styles.flex, styles.gapSm]}>
        <Text variant="caption" tone="text">
          {children}
        </Text>
        <Button label="Open Health Connect" size="sm" variant="secondary" icon="external-link" onPress={() => void health.openManage()} />
      </View>
    </Animated.View>
  );
}

function announce(outcome: Awaited<ReturnType<Health['syncNow']>>, name: string, justConnected = true) {
  if (outcome.status === 'synced') {
    haptics.success();
    toast.success(`Synced ${outcome.daysSent} ${outcome.daysSent === 1 ? 'day' : 'days'} from ${name}`);
  } else if (outcome.status === 'empty') {
    haptics.warning();
    // "Connected —" only right after connecting; a later Sync now just reports what it found.
    toast.info(justConnected ? `Connected — ${name} has no data for the last 30 days yet` : `${name} still has no data for the last 30 days`);
  } else if (outcome.status === 'error') {
    haptics.error();
    toast.error(outcome.message);
  }
}

function IconDisc({ icon, tone, small }: { icon: IconName; tone: 'energy' | 'success' | 'muted'; small?: boolean }) {
  const look =
    tone === 'energy'
      ? { bg: colors.energyBg, fg: colors.energyInk }
      : tone === 'success'
        ? { bg: colors.successBg, fg: colors.success }
        : { bg: colors.canvas2, fg: colors.muted };
  const size = small ? 40 : 52;
  return (
    <View style={[styles.disc, { width: size, height: size, borderRadius: size / 2, backgroundColor: look.bg }]}>
      <Icon name={icon} size={small ? 20 : 24} color={look.fg} />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.md },
  gapSm: { gap: spacing.sm },
  flex: { flex: 1 },
  connectHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  disc: { alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', padding: spacing.md, borderRadius: radii.sm, borderWidth: 1 },
  bannerError: { backgroundColor: colors.errorBg, borderColor: 'rgba(176,44,44,0.18)' },
  bannerInfo: { backgroundColor: colors.infoBg, borderColor: 'rgba(11,143,166,0.18)' },
});
