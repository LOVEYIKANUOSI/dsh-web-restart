# dsh-web-restart

在 DeepSeek Harness Web GUI 的 **设置 → General** 区域添加一行「重启 Web 服务」。

点击按钮后：

1. Host 收到受保护的 POST 请求；
2. 启动一个 detached 看护进程（`lib/guard.cjs`）；
3. 通过 launcher 的 `ctx.appExit` 请求**优雅退出**（会话先落盘）；
4. 看护进程等待旧进程退出（超时则强杀），然后用**完全相同的 node 可执行文件、参数与工作目录**重新拉起 web；
5. 浏览器轮询健康检查路由，新进程就绪后自动刷新页面。

## 安装（web profile）

```jsonc
// profiles/web/package.json
{
  "dependencies": {
    "dsh-web-restart": "link:C:/opencode/dsh-web-restart"
  },
  "dsh": {
    "profile": {
      "bundles": [/* ..., */ "dsh-web-restart"]
    }
  }
}
```

然后 `pnpm install` 并重启一次 `dsh web` 即可生效。

## 路由

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/plugins/dsh-web-restart/restart` | 触发重启（要求自定义头 `x-dsh-web-restart: dsh-web-restart`，防 CSRF） |
| GET | `/plugins/dsh-web-restart/health` | 健康检查，客户端用它判断新进程是否就绪 |
