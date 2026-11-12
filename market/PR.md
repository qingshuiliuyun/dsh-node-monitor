# PR: add dsh-node-monitor

Title: `add: qingshuiliuyun/dsh-node-monitor`

File: `data/plugins/qingshuiliuyun__dsh-node-monitor.yml`

```yaml
url: https://github.com/qingshuiliuyun/dsh-node-monitor
name: qingshuiliuyun/dsh-node-monitor
category: remote
description:
  en: 'Multi-node DSH monitor and control hub: status, read-only sessions, one-click/embedded real DSH UI, plugin toggles and restart (dry-run + audit), filters and batch operations.'
  zh: '多 DSH 节点监控与集中管控：状态总览、只读会话、一键/内嵌打开真实 DSH、插件启停与重启（dry-run + 审计）、筛选与批量操作。'
icon: https://raw.githubusercontent.com/qingshuiliuyun/dsh-node-monitor/main/icon.svg
```

Body:

> Adds `dsh-node-monitor`, a bundle plugin that puts a 「节点监控」 entry in the left sidebar.
>
> - Monitors multiple DSH instances over an authenticated HTTP agent endpoint (`/node-monitor/api/v1/status`), with per-node tokens, loopback self-check, alerts and event feed.
> - Read-only session overview (IDs/status/model/cwd only, never conversation content).
> - Opens a node's real DSH UI: one-click tokenized redirect, or same-site iframe; cross-site degrades to a new tab.
> - Optional DSH-layer ops (disabled by default): list/toggle plugins and restart, `dryRun` default, `confirm` required, JSONL audit at `~/.dsh/node-monitor/audit.jsonl` (0600).
> - Filters, tags, alert deep links and batch probe/enable/disable.
> - `package.json` declares `dsh.bundle.patch` + `dsh.client` (platform: web); host half never imports other client packages; tests 34/34 (`node --test`), verified across two real DSH instances.

Checklist:

- [x] `dsh.bundle` manifest declared in `package.json`
- [x] No runtime dependencies (`dependencies` empty)
- [x] Load safety: `apply()` returns a disposer immediately; 1.5s mount window; PanelBoundary
- [x] Tests pass (`npm test` → 34/34)
- [ ] Icon hosted on GitHub (raw URL) — confirm after repo push
