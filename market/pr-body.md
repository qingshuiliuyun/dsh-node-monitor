Adds `dsh-node-monitor` — a bundle plugin that puts a 「节点监控」 entry in the left sidebar and manages several DSH instances from one panel.

### What it does

- **Multi-node status**: each node runs the same plugin; the panel polls an authenticated agent endpoint (`/node-monitor/api/v1/status`, Bearer token) and shows CPU / memory / disk / load / uptime / latency / sessions per node. A loopback self-check node is created on first install so the real HTTP path is exercised immediately.
- **Read-only session overview**: IDs, status, model and working directory only — conversation content is never read or stored (asserted in tests).
- **Open the real DSH UI**: one-click redirect through a 60-second single-use signed ticket (`/node-monitor/open`), or same-site iframe embedding; cross-site falls back to a new tab.
- **LAN auto-discovery + token pairing**: UDP broadcast (port 45871, multicast 239.255.43.21) carries only node id / label / host / port / version — never a token. Joining a discovered node still requires pasting that node's 12-character pairing token, which avoids pulling in unrelated DSH instances on a shared company network.
- **Opt-in DSH-layer ops** (off by default): list/toggle plugins and restart a node, behind `dryRun` default, `confirm` required, and a JSONL audit log at `~/.dsh/node-monitor/audit.jsonl` (0600).
- **Filters, tags, alert deep links, batch probe/enable/disable.**

### Submission checklist

- [x] One file added: `data/plugins/qingshuiliuyun__dsh-node-monitor.yml`
- [x] `package.json` declares `dsh.bundle.patch` and `dsh.client` (platform: web); the host half imports no other client packages
- [x] Real working code: 38/38 tests (`node --test`), verified across multiple real DSH instances (two-instance dashboard, token pairing, control dry-run + live toggle, LAN discovery)
- [x] Repo topic `dsh-plugin` (set by this submission script)
- [ ] Repo age: created 2026-11-12T11:15:31Z — the one-day gate clears on 2026-11-13T11:15:31Z and CI should re-run itself
- [x] `category: remote` — it is remote multi-node monitoring/control
