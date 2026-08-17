/**
 * dsh-web-restart — Host half.
 *
 * Registers two HTTP routes on the web server:
 *   - POST /plugins/dsh-web-restart/restart  (CSRF-guarded by a custom header)
 *   - GET  /plugins/dsh-web-restart/health   (used by the client to poll until
 *     the relaunched process is serving again, then reload the page)
 *
 * The restart flow: spawn a detached guard process, then request a graceful
 * exit through `ctx.appExit` (the launcher's bounded shutdown controller).
 * The guard waits for this process to die (graceful shutdown first, force-kill
 * after a deadline) and relaunches the exact same invocation — same node
 * binary, same argv, same cwd, inherited stdio — so the web UI comes back on
 * the same host/port with the same log redirection.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const name = "dsh-web-restart";

/** Hard dependency on the HTTP carrier so both routes exist from boot. */
export const inject = ["webServer"];

const RESTART_PATH = "/plugins/dsh-web-restart/restart";
const HEALTH_PATH = "/plugins/dsh-web-restart/health";
const GUARD_HEADER = "x-dsh-web-restart";
const GUARD_HEADER_VALUE = "dsh-web-restart";

/** Absolute path of the guard script shipped beside this module. */
function guardScriptPath() {
  return fileURLToPath(new URL("./guard.cjs", import.meta.url));
}

/**
 * Launch the detached guard process. It receives this process's pid on argv
 * and the relaunch recipe (node binary, argv tail, cwd) through environment
 * variables, which sidesteps all command-line quoting issues.
 */
function spawnGuard() {
  const child = spawn(process.execPath, [guardScriptPath(), String(process.pid)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DSH_RESTART_EXEC: process.execPath,
      DSH_RESTART_ARGV: JSON.stringify(process.argv.slice(1)),
      DSH_RESTART_CWD: process.cwd(),
    },
    detached: true,
    windowsHide: true,
    // stderr/stdout stay inherited so the relaunched dsh keeps writing to the
    // same log files this process was started with.
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.unref();
}

/**
 * Request a graceful, bounded process exit after the guard is in place.
 * `ctx.appExit` is provided by the dsh launcher (`provideCmdline`); fall back
 * to a direct exit when a custom host does not provide it.
 */
function requestGracefulExit(ctx) {
  const exit = ctx.get("appExit");
  if (typeof exit === "function") exit(0);
  else process.exit(0);
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: RESTART_PATH,
    handler: (req, res) => {
      // CSRF fence: a cross-origin page cannot send a custom header without a
      // preflight, and this route rejects everything that is not the exact
      // POST it expects (OPTIONS included).
      if (req.method !== "POST" || req.headers[GUARD_HEADER] !== GUARD_HEADER_VALUE) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "forbidden" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      // Let the response flush before the shutdown begins.
      spawnGuard();
      setTimeout(() => requestGracefulExit(ctx), 400);
    },
  }), "dsh-web-restart: restart route");

  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: HEALTH_PATH,
    handler: (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    },
  }), "dsh-web-restart: health route");
}
