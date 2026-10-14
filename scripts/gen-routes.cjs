#!/usr/bin/env node
/**
 * Regenerate expo-router typed routes (.expo/types/router.d.ts) WITHOUT starting the dev server.
 * `npx expo start` normally does this; run `npm run routes` after adding/removing a route file so
 * `npx tsc --noEmit` knows the new hrefs. Uses the same generator the Expo CLI calls.
 */
const path = require("node:path");
const fs = require("node:fs");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..");
// The generator reads the app root when it is first required, so set it before loading it.
process.env.EXPO_ROUTER_APP_ROOT = path.join(root, "src", "app");
const fromExpo = createRequire(require.resolve("expo/package.json", { paths: [root] }));
const fromCli = createRequire(fromExpo.resolve("@expo/cli/package.json"));
const typedRoutes = fromCli("@expo/router-server/build/typed-routes");

const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8")).expo;
const typesDir = path.join(root, ".expo", "types");
fs.mkdirSync(typesDir, { recursive: true });

// regenerateDeclarations is debounced; Node stays alive until its timer fires and the file is written.
typedRoutes.regenerateDeclarations(typesDir, app.extra && app.extra.router);
process.on("exit", () => console.log("typed routes regenerated →", path.relative(root, path.join(typesDir, "router.d.ts"))));
