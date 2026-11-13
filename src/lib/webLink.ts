/**
 * Website pages the app opens carry `from=app` (D3 decision D5): the website then hides its menu and its links to the
 * marketing and pricing pages for the rest of that in-app browser tab's visit (web `src/lib/from-app.ts`), so the
 * in-app browser shows the legal or account page with a way back, and never the website's plans (App Review 3.1.1 /
 * 3.1.3: nothing to buy, and no route to a price, inside the app). Normal website visitors never send it.
 *
 * Pure (no React Native), so `npm run test:links` loads it in Node. `lib/web.ts` `openWebsite` is the one place the app
 * opens a website page; it passes every address through `appWebUrl`.
 */

/** The query the website reads (web `src/lib/from-app.ts` `FROM_APP_PARAM` / `FROM_APP_VALUE`). */
export const FROM_APP_KEY = 'from';
export const FROM_APP_VALUE = 'app';

/** `url` with `from=app` in its query, before any `#fragment`. A `from` already there is replaced; nothing else changes. */
export function withFromApp(url: string): string {
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const queryAt = beforeHash.indexOf('?');
  const base = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt === -1 ? '' : beforeHash.slice(queryAt + 1);
  const kept = query.split('&').filter((p) => p !== '' && p.split('=')[0] !== FROM_APP_KEY);
  return `${base}?${[...kept, `${FROM_APP_KEY}=${FROM_APP_VALUE}`].join('&')}${hash}`;
}

/** True when `url` is a page of the website at `origin` (same scheme, host and port), e.g. a link in an ÖRZA reply. */
export function isWebsiteUrl(url: string, origin: string): boolean {
  const o = origin.replace(/\/+$/, '').toLowerCase();
  const u = url.toLowerCase();
  return u === o || u.startsWith(`${o}/`) || u.startsWith(`${o}?`) || u.startsWith(`${o}#`);
}

/**
 * The address the app opens for `target`: a site path ("/privacy#ai-processing") becomes `origin + path`; a full URL on
 * the website stays as it is. Both get `from=app`. A full URL on any other site is returned unchanged.
 */
export function appWebUrl(target: string, origin: string): string {
  if (target.startsWith('/')) return withFromApp(`${origin.replace(/\/+$/, '')}${target}`);
  return isWebsiteUrl(target, origin) ? withFromApp(target) : target;
}
