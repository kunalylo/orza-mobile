/**
 * Calendar feed — the private ICS subscribe link (doses + reminders with alarms) for Google / Apple / Outlook,
 * with copy / share, provider steps, replace and turn off. POST/DELETE /api/calendar/token.
 */
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Linking, Platform, Share, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { CardHeader, ConfirmStrip } from '@/features/reminders/parts';
import { errorMessage } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { colors, fonts, radii, spacing } from '@/theme';
import { Button, GlassCard, Icon, IconButton, Segmented, Skeleton, Text, toast } from '@/ui';

import { useFeedToken, useRevokeFeed } from './api';
import type { CalendarFeedLinks } from './types';

const googleSubscribeUrl = (webcal: string) => `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
const outlookSubscribeUrl = (feed: string) => `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feed)}&name=${encodeURIComponent('ÖRZA')}`;

type Provider = 'apple' | 'google' | 'outlook';

const STEPS: Record<Provider, string> = {
  google:
    'Opens Google Calendar with the link filled in — choose Add. Google ignores alerts inside subscribed calendars, so open Settings, pick the ÖRZA calendar under Other calendars and add an event notification at 0 minutes. Google refreshes subscriptions every few hours, so new medicines can take a while to appear there.',
  apple:
    'Tap the button and choose Subscribe. Turn off Remove Alerts so doses ring. On a Mac, set Auto-refresh to Every hour in the calendar’s Get Info panel.',
  outlook:
    'Opens Outlook on the web with the link filled in — choose Import. In the Outlook app, use Add calendar → Subscribe from web and paste the link. Outlook refreshes subscriptions every few hours, and some versions don’t pop up alerts for them.',
};

const hostOf = (url: string) => {
  const m = /^[a-z]+:\/\/([^/]+)/i.exec(url);
  return m ? m[1] : url;
};

async function open(url: string) {
  try {
    if (/^https:/i.test(url)) await WebBrowser.openBrowserAsync(url);
    else await Linking.openURL(url);
  } catch {
    toast.error("Couldn't open that calendar app. Copy the link and add it by hand.");
  }
}

export function SubscribeCard({ feed, isLocal, loading }: { feed: CalendarFeedLinks | null; isLocal: boolean; loading: boolean }) {
  const reduceMotion = useReducedMotion();
  const token = useFeedToken();
  const revoke = useRevokeFeed();
  const [provider, setProvider] = useState<Provider>(Platform.OS === 'ios' ? 'apple' : 'google');
  const [confirm, setConfirm] = useState<'rotate' | 'revoke' | null>(null);

  const create = (mode: 'create' | 'rotate') => {
    haptics.firm();
    token.mutate(undefined, {
      onSuccess: () => {
        haptics.success();
        setConfirm(null);
        toast.success(mode === 'rotate' ? 'New link created. The old one has stopped working — subscribe again with this one.' : 'Your calendar link is ready.');
      },
      onError: (e) => {
        haptics.error();
        toast.error(errorMessage(e));
      },
    });
  };

  const turnOff = () =>
    revoke.mutate(undefined, {
      onSuccess: () => {
        haptics.success();
        setConfirm(null);
        toast.success('Calendar link turned off. Subscribed calendars will stop updating.');
      },
      onError: (e) => {
        haptics.error();
        toast.error(errorMessage(e));
      },
    });

  const copy = async () => {
    if (!feed) return;
    try {
      await Clipboard.setStringAsync(feed.feed_url);
      haptics.success();
      toast.success('Link copied');
    } catch {
      toast.error("Couldn't copy the link. Long-press it to select it instead.");
    }
  };

  const share = async () => {
    if (!feed) return;
    haptics.tap();
    try {
      await Share.share(Platform.OS === 'ios' ? { url: feed.feed_url } : { message: feed.feed_url, title: 'ÖRZA calendar link' });
    } catch {
      // dismissed
    }
  };

  const openProvider = () => {
    if (!feed) return;
    haptics.tap();
    if (provider === 'apple') void open(feed.webcal_url);
    else if (provider === 'google') void open(googleSubscribeUrl(feed.webcal_url));
    else void open(outlookSubscribeUrl(feed.feed_url));
  };

  return (
    <GlassCard padding={spacing.lg}>
      <CardHeader
        icon="mci:calendar-import"
        tone="amber"
        eyebrow="Calendar feed"
        title="Subscribe from any calendar"
        body="Subscribe once and every medicine dose — plus reminders you've added to the calendar — appears as an event with an alert in Google, Apple or Outlook, on every device you use."
      />

      {loading ? (
        <View style={styles.skel}>
          <Skeleton width="100%" height={48} radius={radii.md} />
          <Skeleton width="55%" height={36} radius={radii.pill} />
        </View>
      ) : !feed ? (
        <View>
          <Button label="Create my calendar link" icon="link" variant="primary" loading={token.isPending} onPress={() => create('create')} style={styles.cta} />
          <Text variant="caption" tone="subtle" style={styles.hint}>
            The link is private to you. You can replace it or turn it off at any time.
          </Text>
        </View>
      ) : (
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(200)}>
          <Text variant="eyebrow" tone="subtle" style={styles.label}>
            Your private calendar link
          </Text>
          <View style={styles.linkRow}>
            <View style={styles.linkBox}>
              <Icon name="lock" size={14} color={colors.subtle} />
              <Text selectable numberOfLines={2} style={styles.link}>
                {feed.feed_url}
              </Text>
            </View>
            <IconButton icon="copy" variant="glass" accessibilityLabel="Copy calendar link" onPress={() => void copy()} />
            <IconButton icon="share-2" variant="glass" accessibilityLabel="Share calendar link" onPress={() => void share()} />
          </View>

          <Segmented<Provider>
            accessibilityLabel="Your calendar app"
            value={provider}
            onChange={(v) => {
              haptics.select();
              setProvider(v);
            }}
            options={[
              { value: 'apple', label: 'Apple' },
              { value: 'google', label: 'Google' },
              { value: 'outlook', label: 'Outlook' },
            ]}
            size="sm"
            style={styles.segmented}
          />
          <Text variant="small" tone="muted" style={styles.steps}>
            {STEPS[provider]}
          </Text>
          <Button
            label={provider === 'apple' ? 'Subscribe in Apple Calendar' : provider === 'google' ? 'Add to Google Calendar' : 'Add to Outlook'}
            iconRight="external-link"
            variant="secondary"
            size="sm"
            onPress={openProvider}
            style={styles.cta}
          />

          <View style={styles.privacy}>
            <Icon name="shield" size={14} color={colors.subtle} />
            <Text variant="caption" tone="subtle" style={styles.flex}>
              Anyone with this link can see your medicine names and times. Keep it to yourself — if it&apos;s shared by mistake, replace it.
            </Text>
          </View>

          {confirm ? (
            <ConfirmStrip
              tone={confirm === 'rotate' ? 'primary' : 'danger'}
              message={
                confirm === 'rotate'
                  ? 'ÖRZA will create a new private link. The current link stops working straight away, so calendars subscribed to it stop updating until you subscribe again with the new one.'
                  : 'Calendars subscribed to this link will stop updating, and dose alarms from ÖRZA will no longer appear in them. You can create a new link later.'
              }
              confirmLabel={confirm === 'rotate' ? 'Replace link' : 'Turn off link'}
              busy={token.isPending || revoke.isPending}
              onCancel={() => setConfirm(null)}
              onConfirm={() => (confirm === 'rotate' ? create('rotate') : turnOff())}
            />
          ) : (
            <View style={styles.actions}>
              <Button label="Replace link" icon="refresh-cw" variant="secondary" size="sm" onPress={() => setConfirm('rotate')} />
              <Button label="Turn off" icon="trash-2" variant="ghost" size="sm" onPress={() => setConfirm('revoke')} />
            </View>
          )}
        </Animated.View>
      )}

      {isLocal && !loading ? (
        <View style={styles.warn} accessibilityRole="alert">
          <Icon name="alert-triangle" size={16} color={colors.warning} />
          <Text variant="caption" tone="warning" style={styles.flex}>
            {feed ? `This link points to ${hostOf(feed.feed_url)}, which only your computer can reach. ` : 'ÖRZA is running on a development computer. '}
            Google, Apple and Outlook fetch the calendar from the internet, so subscribing works once ÖRZA is live at its public address.
          </Text>
        </View>
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  skel: { marginTop: spacing.lg, gap: spacing.md },
  cta: { marginTop: spacing.lg, alignSelf: 'flex-start' },
  hint: { marginTop: spacing.sm },
  label: { marginTop: spacing.lg, marginBottom: spacing.sm },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  linkBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 48,
    borderRadius: radii.md,
    backgroundColor: colors.glassSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineStrong,
  },
  link: { flex: 1, fontFamily: fonts.mono, fontSize: 12, lineHeight: 16, color: colors.text },
  segmented: { marginTop: spacing.lg },
  steps: { marginTop: spacing.md },
  privacy: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginTop: spacing.lg },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  warn: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.warningBg,
  },
});
