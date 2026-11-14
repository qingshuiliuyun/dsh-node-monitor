# PR: add dsh-node-monitor

Title: `add: qingshuiliuyun/dsh-node-monitor`

File: `data/plugins/qingshuiliuyun__dsh-node-monitor.yml`

```yaml
url: https://github.com/qingshuiliuyun/dsh-node-monitor
name: qingshuiliuyun/dsh-node-monitor
category: remote
description:
  en: 'Multi-node DSH monitor and control hub: per-node status and read-only sessions, zero-config LAN networking via UDP discovery, one-click/embedded access to a real DSH UI, cross-network remote hub via outbound push, serverless invite links/IPv6, and opt-in plugin toggle/restart behind dry-run, confirmation and a JSONL audit log.'
  zh: '多 DSH 节点监控与集中管控：逐节点状态与只读会话、UDP 发现零配置组网、一键/内嵌打开真实 DSH、跨网反向接入的远程主节点、无服务器接入码/IPv6，以及默认关闭的插件启停/重启（干跑、二次确认、JSONL 审计）。'
icon: https://raw.githubusercontent.com/qingshuiliuyun/dsh-node-monitor/main/assets/icon-180.png
```

Body:

> Adds `dsh-node-monitor`, a bundle plugin that puts a 「节点监控」 entry in the left sidebar.
>
> - Monitors multiple DSH instances over an authenticated HTTP agent endpoint (`/node-monitor/api/v1/status`), with per-node tokens, loopback self-check, alerts and event feed.
> - Zero-config LAN networking: UDP discovery on `45871` + a dedicated agent listener on `45873`; auto-pairs read-only `statusToken`, so the DSH web port never needs to be exposed.
> - Remote hub for cross-network setups: PCs push status to a public DSH every 3s and pull queued commands; no inbound ports or VPN required.
> - Serverless options: share an invite link/QR (`#node-monitor-add=…`) or join link (`#node-monitor-join=…`), with IPv6/Tailscale/ZeroTier addresses.
> - Security hardening (v0.6.3): read-only token for auto-pairing, control disabled by default, 20s command expiry, peer caps, request timeouts, audit rotation.
> - Read-only session overview (IDs/status/model/cwd only, never conversation content).
> - Opens a node's real DSH UI: one-click tokenized redirect, or same-site iframe; cross-site degrades to a new tab.
> - Optional DSH-layer ops (disabled by default): list/toggle plugins and restart, `dryRun` default, `confirm` required, JSONL audit at `~/.dsh/node-monitor/audit.jsonl` (0600).
> - Filters, tags, alert deep links and batch probe/enable/disable.
> - `package.json` declares `dsh.bundle.patch` + `dsh.client` (platform: web); host half never imports other client packages; tests 51/51 (`node --test`), verified across two real DSH instances.
- Security hardening (v0.6.6–v0.6.7): auto-pair rate limits + auto-node cap, hub command results bound to `nodeId`, http(s)-only `publicUrl`, join/invite link validation, QR SVG whitelist, periodic cleanup of counters/queues.
- Docs: `README.md` / `README.en.md`, `DESIGN.md`, `docs/SECURITY.md`, `docs/CHANGELOG.md`, `docs/ARCHITECTURE-DECISIONS.md`, `docs/INSTALL.md`.

Checklist:

- [x] `dsh.bundle` manifest declared in `package.json`
- [x] No runtime dependencies (`dependencies` empty)
- [x] Load safety: `apply()` returns a disposer immediately; 1.5s mount window; PanelBoundary
- [x] Tests pass (`npm test` → 50/50)
- [x] Icon hosted on GitHub (raw PNG at `assets/icon-180.png`)
