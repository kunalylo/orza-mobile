/** The More tab's grouped menu. */
import type { Href } from 'expo-router';

import { TINTS, type Tint } from '@/features/settings/parts';
import type { IconName } from '@/ui';

export interface MenuItem {
  key: string;
  href: Href;
  title: string;
  subtitle: string;
  icon: IconName;
  tint: Tint;
}

export interface MenuSection {
  title: string;
  items: MenuItem[];
}

export const MENU: MenuSection[] = [
  {
    title: 'Coach',
    items: [
      { key: 'ask', href: '/ask', title: 'Ask ÖRZA', subtitle: 'Chat about food, habits and your plan', icon: 'mci:chat-processing-outline', tint: TINTS.energy },
      { key: 'recipes', href: '/recipes', title: 'Recipes', subtitle: 'Dishes that fit your diet, region and targets', icon: 'mci:chef-hat', tint: TINTS.energy },
      { key: 'rebalance', href: '/rebalance', title: 'Rebalance', subtitle: 'A kind plan after a special meal', icon: 'mci:scale-balance', tint: TINTS.violet },
    ],
  },
  {
    title: 'Progress',
    items: [
      { key: 'goals', href: '/goals', title: 'Goals', subtitle: 'Weight goal, pace and weigh-ins', icon: 'mci:target', tint: TINTS.energy },
      { key: 'reports', href: '/reports', title: 'Reports', subtitle: 'Daily and weekly trends, wins and insights', icon: 'mci:chart-box-outline', tint: TINTS.violet },
    ],
  },
  {
    title: 'Care',
    items: [
      { key: 'reminders', href: '/reminders', title: 'Reminders', subtitle: 'Water, meals, walks — your way', icon: 'mci:bell-ring-outline', tint: TINTS.cyan },
      { key: 'calendar', href: '/calendar', title: 'Calendar', subtitle: 'Your plans and medicine times together', icon: 'mci:calendar-month-outline', tint: TINTS.cyan },
      { key: 'health', href: '/health', title: 'Health sync', subtitle: 'Steps, sleep and heart rate from your phone', icon: 'mci:heart-pulse', tint: TINTS.cyan },
    ],
  },
  {
    title: 'Account',
    items: [
      { key: 'credits', href: '/credits', title: 'AI credits', subtitle: 'Balance, history and top-ups', icon: 'mci:lightning-bolt-outline', tint: TINTS.energy },
      { key: 'settings', href: '/settings', title: 'Settings', subtitle: 'Profile, targets, privacy and your data', icon: 'mci:cog-outline', tint: TINTS.ink },
    ],
  },
];
