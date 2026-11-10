// Preload for the LOCAL test server (node --require, via NODE_OPTIONS): makes sure no request can reach OpenAI during
// device tests. The local copy's .env.local holds a real key, so two guards:
// 1. OPENAI_API_KEY is set to an empty string before Next loads .env.local (Next keeps a variable that is already set),
//    so aiEnabled() is false and the AI routes answer with their built-in fallbacks.
// 2. fetch to api.openai.com throws, in case the key still got through.
// Used by scripts/e2e/localtest-noai.cmd; check GET /api/credits/balance → ai_enabled: false before testing.
process.env.OPENAI_API_KEY = '';
const realFetch = globalThis.fetch;
globalThis.fetch = function guardedFetch(input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  if (typeof url === 'string' && /^https?:\/\/([^/]*\.)?openai\.com(\/|$)/i.test(url)) {
    return Promise.reject(new Error('blocked by noai-preload: no AI calls from the local test server'));
  }
  return realFetch.call(this, input, init);
};
