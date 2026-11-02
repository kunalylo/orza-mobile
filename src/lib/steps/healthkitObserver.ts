/**
 * Apple Health's background delivery of new steps (`docs/notes/steps-v2.md` §4.3) exists on the iPhone only:
 * `healthkitObserver.ios.ts`, which Metro picks on iOS. Everywhere else (and for TypeScript's resolution of
 * `index.ts`'s import) this file, which does nothing.
 */
export {};
