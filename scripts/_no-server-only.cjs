// Preload via NODE_OPTIONS="--require ./scripts/_no-server-only.cjs" for
// harness scripts that import from lib/ai/*. Two jobs:
//
//   1. Load .env.local before any other module initializes (eager modules
//      like lib/prisma.ts read process.env at top level).
//   2. Stub `import "server-only"` to an empty module. The real package
//      throws when loaded by raw Node — that's its job inside a Next build,
//      but it gets in the way of script harnesses.

require("dotenv").config({ path: ".env.local" });

const Module = require("node:module");
const VIRTUAL = "/__virtual_server-only__.js";

Module._cache[VIRTUAL] = {
  id: VIRTUAL,
  filename: VIRTUAL,
  loaded: true,
  exports: {},
  children: [],
  paths: [],
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") return VIRTUAL;
  return origResolve.call(this, request, ...args);
};
