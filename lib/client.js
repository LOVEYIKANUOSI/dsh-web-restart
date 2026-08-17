// dsh-web-restart — Client half (hand-written `__ModuleLoader__` factory, no
// bundler required: only React and shipped primitives are imported, both of
// which the shell already provides).
//
// Registers one row in the General settings section: "Restart Web". Clicking
// it POSTs the guarded restart route, shows a busy state, and polls the
// health route until the relaunched process serves again — then reloads.
window.__ModuleLoader__.load({
  id: "dsh-web-restart",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    // Row styles, matching the shipped settings rows (theme tokens only).
    const CSS = [
      ".wr_row{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}",
      ".wr_text{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}",
      ".wr_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}",
      ".wr_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}",
    ].join("");

    const CSS_TAG = "dsh-web-restart/settings-row";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG) + "]") === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-web-restart";
      tag.dataset.pluginCss = CSS_TAG;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    const dict = {
      zh: {
        title: "重启 Web 服务",
        desc: "用相同的端口与配置重启当前 Web 服务，页面会在新进程就绪后自动刷新。",
        button: "重启 Web",
        restarting: "正在重启…",
      },
      en: {
        title: "Restart Web",
        desc: "Restart this Web server with the same port and configuration. The page reloads once the new process is up.",
        button: "Restart Web",
        restarting: "Restarting…",
      },
    };

    const RESTART_URL = "/plugins/dsh-web-restart/restart";
    const HEALTH_URL = "/plugins/dsh-web-restart/health";

    /**
     * The settings row. `requestRestart` is injected by apply(); `t` comes
     * from the slot system via the `locale` registration option.
     */
    function WebRestartRow({ requestRestart, t }) {
      const [restarting, setRestarting] = React.useState(false);

      // While a restart is in flight, poll the health route of the *new*
      // process and reload once it answers.
      React.useEffect(() => {
        if (!restarting) return;
        let cancelled = false;
        (async () => {
          for (let i = 0; i < 90 && !cancelled; i++) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            if (cancelled) return;
            try {
              const res = await fetch(HEALTH_URL, { cache: "no-store" });
              if (res.ok) {
                window.location.reload();
                return;
              }
            } catch {}
          }
        })();
        return () => {
          cancelled = true;
        };
      }, [restarting]);

      const onClick = () => {
        if (restarting) return;
        setRestarting(true);
        requestRestart().catch(() => setRestarting(false));
      };

      return React.createElement(
        "div",
        { className: "wr_row" },
        React.createElement(
          "div",
          { className: "wr_text" },
          React.createElement("div", { className: "wr_title" }, t("title")),
          React.createElement("div", { className: "wr_desc" }, t("desc")),
        ),
        React.createElement(
          primitives.Button,
          { variant: "outline", size: "md", disabled: restarting, onClick },
          restarting ? t("restarting") : t("button"),
        ),
      );
    }

    const inject = ["slots", "locale"];

    function apply(ctx) {
      ctx.effect(
        () => ctx.locale.register("settings.webRestart", dict),
        "dsh-web-restart: locale dictionaries",
      );

      const injected = () => ({
        requestRestart: () => fetch(RESTART_URL, {
          method: "POST",
          headers: { "x-dsh-web-restart": "dsh-web-restart" },
        }).then((res) => {
          if (!res.ok) throw new Error("restart request failed: " + res.status);
        }),
      });

      ctx.slots.inject("settings.general.item", () => ctx.slots.register({
        name: "settings.general.item",
        id: "web-restart",
        order: 30,
        locale: "settings.webRestart",
        inject: injected,
      }, WebRestartRow));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
