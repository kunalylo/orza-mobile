/**
 * Opening the ÖRZA website from the app: every page (privacy, terms, trust, the AI section, the health importers, the
 * admin console, a website link in an ÖRZA reply) goes through `openWebsite`, which adds `from=app` (`./webLink`, D5)
 * so the website hides its menu and pricing links in the in-app browser. Other sites open unchanged.
 */
import * as WebBrowser from 'expo-web-browser';

import { WEB_URL } from './config';
import { appWebUrl } from './webLink';

/** The address the app opens for a site path ("/terms") or a full URL (see `appWebUrl`). */
export const websiteUrl = (target: string) => appWebUrl(target, WEB_URL);

/** Opens `target` (a site path or a full URL) in the in-app browser, with `from=app` when it is the ÖRZA website. */
export function openWebsite(target: string, options?: WebBrowser.WebBrowserOpenOptions) {
  return WebBrowser.openBrowserAsync(websiteUrl(target), options);
}
