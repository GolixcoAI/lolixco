import * as realChildProcess from "node:child_process";

// Cache original unpatched references to prevent recursion when syncBuiltinESMExports() is called
const _origSpawnSync = realChildProcess.spawnSync;
const _origSpawn = realChildProcess.spawn;
const _origExecSync = realChildProcess.execSync;
const _origExec = realChildProcess.exec;
const _origExecFile = realChildProcess.execFile;
const _origExecFileSync = realChildProcess.execFileSync;
const _origFork = realChildProcess.fork;

// Strictly allowlisted execution environment variables
// Explicitly EXCLUDES: NODE_OPTIONS, NODE_PATH, YOUTUBE_DATA_API_KEY, YOUTUBE_API_KEY, AWS credentials
const ALLOWLISTED_ENV_VARS = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "TERM",
  "CI",
  "npm_lifecycle_event",
]);

/**
 * Creates an allowlisted, sanitized environment object for child processes spawned during tests.
 * Strips all real workstation secrets, removes Node preload hooks, and enforces test isolation flags.
 *
 * @param {object|undefined} callerEnv
 * @returns {Record<string, string>}
 */
export function createIsolatedEnvironment(callerEnv) {
  const base = callerEnv || process.env;
  const isolated = {};

  for (const [key, val] of Object.entries(base)) {
    if (ALLOWLISTED_ENV_VARS.has(key)) {
      isolated[key] = String(val);
    }
  }

  // Strict enforcement of test isolation flags (cannot be overridden by caller)
  isolated.NODE_ENV = "test";
  isolated.LOLIXCO_TEST_ISOLATION = "1";
  isolated.LOLIXCO_TEST_MODE = "1";

  // Real credentials and node startup hooks are NEVER passed to child processes
  delete isolated.YOUTUBE_DATA_API_KEY;
  delete isolated.YOUTUBE_API_KEY;
  delete isolated.AWS_ACCESS_KEY_ID;
  delete isolated.AWS_SECRET_ACCESS_KEY;
  delete isolated.AWS_SESSION_TOKEN;
  delete isolated.NODE_OPTIONS;
  delete isolated.NODE_PATH;

  // Permit deterministic synthetic test keys explicitly injected by offline test cases
  if (callerEnv && typeof callerEnv.YOUTUBE_API_KEY === "string") {
    if (
      callerEnv.YOUTUBE_API_KEY.startsWith("LOLIXCO_SYNTHETIC_") ||
      callerEnv.YOUTUBE_API_KEY.startsWith("AIzaSyFake") ||
      callerEnv.YOUTUBE_API_KEY.startsWith("AIzaSyTest")
    ) {
      isolated.YOUTUBE_API_KEY = callerEnv.YOUTUBE_API_KEY;
    }
  }

  return isolated;
}

export function spawnSync(command, args, options) {
  let finalArgs = args;
  let finalOptions = options;
  if (!Array.isArray(args) && typeof args === "object" && args !== null) {
    finalOptions = args;
    finalArgs = [];
  }
  const opts = { ...(finalOptions || {}) };
  opts.env = createIsolatedEnvironment(opts.env);
  return _origSpawnSync(command, finalArgs, opts);
}

export function spawn(command, args, options) {
  let finalArgs = args;
  let finalOptions = options;
  if (!Array.isArray(args) && typeof args === "object" && args !== null) {
    finalOptions = args;
    finalArgs = [];
  }
  const opts = { ...(finalOptions || {}) };
  opts.env = createIsolatedEnvironment(opts.env);
  return _origSpawn(command, finalArgs, opts);
}

export function execSync(command, options = {}) {
  const opts = { ...options };
  opts.env = createIsolatedEnvironment(opts.env);
  return _origExecSync(command, opts);
}

export function exec(command, options, callback) {
  const opts = typeof options === "function" ? {} : { ...(options || {}) };
  const cb = typeof options === "function" ? options : callback;
  opts.env = createIsolatedEnvironment(opts.env);
  return _origExec(command, opts, cb);
}

export function execFile(file, args, options, callback) {
  let finalArgs = args;
  let finalOptions = options;
  let finalCb = callback;

  if (typeof args === "function") {
    finalCb = args;
    finalArgs = [];
    finalOptions = {};
  } else if (!Array.isArray(args) && typeof args === "object" && args !== null) {
    finalOptions = args;
    finalArgs = [];
    finalCb = options;
  } else if (typeof options === "function") {
    finalCb = options;
    finalOptions = {};
  }

  const opts = { ...(finalOptions || {}) };
  opts.env = createIsolatedEnvironment(opts.env);
  return _origExecFile(file, finalArgs, opts, finalCb);
}

export function execFileSync(file, args, options) {
  let finalArgs = args;
  let finalOptions = options;
  if (!Array.isArray(args) && typeof args === "object" && args !== null) {
    finalOptions = args;
    finalArgs = [];
  }
  const opts = { ...(finalOptions || {}) };
  opts.env = createIsolatedEnvironment(opts.env);
  return _origExecFileSync(file, finalArgs, opts);
}

export function fork(modulePath, args, options) {
  let finalArgs = args;
  let finalOptions = options;
  if (!Array.isArray(args) && typeof args === "object" && args !== null) {
    finalOptions = args;
    finalArgs = [];
  }
  const opts = { ...(finalOptions || {}) };
  opts.env = createIsolatedEnvironment(opts.env);
  return _origFork(modulePath, finalArgs, opts);
}

export const rawSpawnSync = _origSpawnSync;
export const rawExecFileSync = _origExecFileSync;

export default {
  spawn,
  spawnSync,
  exec,
  execSync,
  execFile,
  execFileSync,
  fork,
  createIsolatedEnvironment,
  rawSpawnSync,
  rawExecFileSync,
};

