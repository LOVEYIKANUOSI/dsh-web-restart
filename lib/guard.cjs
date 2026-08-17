// dsh-web-restart guard — a detached watcher that relaunches the dsh web
// process it was asked to guard.
//
// Usage: node guard.cjs <target-pid>
// Recipe env: DSH_RESTART_EXEC, DSH_RESTART_ARGV (JSON array), DSH_RESTART_CWD
//
// Behaviour: poll the target pid. Once it is gone (graceful shutdown
// preferred) relaunch the exact same invocation with inherited stdio. If the
// target survives past the grace deadline, force-kill it first. Either way
// the relaunch happens exactly once.
"use strict";

const { spawn } = require("node:child_process");

const TARGET = Number(process.argv[2]);
const EXEC = process.env.DSH_RESTART_EXEC;
const CWD = process.env.DSH_RESTART_CWD || process.cwd();
const GRACE_MS = 10000;
let ARGV = [];
try {
  ARGV = JSON.parse(process.env.DSH_RESTART_ARGV || "[]");
} catch {
  ARGV = [];
}

if (!Number.isInteger(TARGET) || TARGET <= 0 || typeof EXEC !== "string" || EXEC === "") {
  console.error("[dsh-web-restart] guard: need a valid target pid and DSH_RESTART_EXEC");
  process.exit(1);
}

/** True while the guarded process still exists. */
function alive() {
  try {
    process.kill(TARGET, 0);
    return true;
  } catch {
    return false;
  }
}

let launched = false;

function startNew(attempt) {
  let child;
  try {
    child = spawn(EXEC, ARGV, {
      cwd: CWD,
      detached: true,
      windowsHide: true,
      stdio: "inherit",
    });
  } catch (error) {
    console.error("[dsh-web-restart] guard: spawn failed:", error);
    if (attempt < 3) setTimeout(() => startNew(attempt + 1), 1500);
    return;
  }
  child.on("error", (error) => {
    console.error("[dsh-web-restart] guard: child error:", error);
    if (attempt < 3) setTimeout(() => startNew(attempt + 1), 1500);
  });
  child.unref();
}

function finish() {
  if (launched) return;
  launched = true;
  clearInterval(timer);
  // Small settle delay so the OS fully releases the listen port before bind.
  setTimeout(() => startNew(0), 600);
}

const startedAt = Date.now();
const timer = setInterval(() => {
  if (launched) return;
  if (!alive()) {
    finish();
    return;
  }
  if (Date.now() - startedAt > GRACE_MS) {
    // Graceful shutdown did not complete in time — force it.
    try {
      process.kill(TARGET, "SIGKILL");
    } catch {}
    clearInterval(timer);
    setTimeout(finish, 1200);
  }
}, 300);

// Absolute fallback: never linger forever, even if polling misbehaves.
setTimeout(finish, GRACE_MS + 5000);
