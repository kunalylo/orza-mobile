/**
 * ÖRZA's replies may link app pages with the website's relative paths ("[Rebalance](/dashboard/compensation)" —
 * the coach prompt lists them). On the phone those open the matching screen; unknown paths stay plain text.
 */
import { router } from 'expo-router';

type AppLink = { pathname: string; params?: Record<string, string>; tab?: boolean };

const PAGES: Record<string, AppLink> = {
  '': { pathname: '/', tab: true },
  today: { pathname: '/', tab: true },
  meals: { pathname: '/meals', tab: true },
  scan: { pathname: '/snap', tab: true },
  medicines: { pathname: '/medicines', tab: true },
  chat: { pathname: '/ask' },
  compensation: { pathname: '/rebalance' },
  goals: { pathname: '/goals' },
  recipes: { pathname: '/recipes' },
  reports: { pathname: '/reports' },
  settings: { pathname: '/settings' },
  credits: { pathname: '/credits' },
  reminders: { pathname: '/reminders' },
  calendar: { pathname: '/calendar' },
  health: { pathname: '/health' },
};

/** The app screen for a website path like "/dashboard/meals?date=2026-10-26", or null. */
export function appLinkFor(href: string): AppLink | null {
  const m = href.match(/^\/dashboard(?:\/([a-z-]+))?\/?(?:\?([^#]*))?(?:#.*)?$/);
  if (!m) return null;
  const key = m[1] ?? '';
  const page = Object.prototype.hasOwnProperty.call(PAGES, key) ? PAGES[key] : null;
  if (!page) return null;
  // The meal log opens on the day the reply linked (the Meals tab reads `date`).
  const date = (m[2] ?? '').match(/(?:^|&)date=(\d{4}-\d{2}-\d{2})(?:&|$)/)?.[1];
  return date && page.pathname === '/meals' ? { ...page, params: { date } } : page;
}

/** Opens an app link: tabs are switched to, other screens open on top of the chat (Back returns to it). */
export function openAppLink(link: AppLink) {
  const target = { pathname: link.pathname, params: link.params } as Parameters<typeof router.push>[0];
  if (link.tab) router.navigate(target);
  else router.push(target);
}
