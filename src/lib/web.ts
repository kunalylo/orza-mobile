/**
 * Opening the ÖRZA website from the app: every page (privacy, terms, trust, the AI section, the health importers, the
 * admin console, a website link in an ÖRZA reply) goes through `openWebsite`, which adds `from=app` (`./webLink`, D5)
 * so the website hides its menu and pricing links in the in-app browser. Other sites open unchanged. The website's
 * home page and Pricing never open from the app (`websiteBlocked`).
 */
import * as WebBrowser from 'expo-web-browser';

import { WEB_URL } from './config';
import { appWebUrl, websitePageBlocked } from './webLink';

/** The address the app opens for a site path ("/terms") or a full URL (see `appWebUrl`). */
export const websiteUrl = (target: string) => appWebUrl(target, WEB_URL);

/** True for the website's home page and Pricing (a site path or a full URL), which the app never opens. */
export const websiteBlocked = (target: string) => websitePageBlocked(target, WEB_URL);

/**
 * Opens `target` (a site path or a full URL) in the in-app browser, with `from=app` when it is the ÖRZA website.
 * Rejects, opening nothing, for the website's home page and Pricing.
 */
export function openWebsite(target: string, options?: WebBrowser.WebBrowserOpenOptions) {
  if (websiteBlocked(target)) return Promise.reject(new Error('That page of the ÖRZA website is not opened from the app.'));
  return WebBrowser.openBrowserAsync(websiteUrl(target), options);
}
