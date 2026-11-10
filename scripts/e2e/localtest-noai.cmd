@echo off
rem The LOCAL test server (E:\aylo\orza-localtest, JSON-file DB) with AI blocked: see noai-preload.cjs.
rem Started by the preview config "orza-localtest-noai". Check GET /api/credits/balance -> ai_enabled: false before testing.
cd /d E:\aylo\orza-localtest
set NODE_OPTIONS=--require E:/aylo/orza-mobile/scripts/e2e/noai-preload.cjs
npm run dev
