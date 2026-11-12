# dsh-node-monitor 设计文档

> 适用版本：**v0.6.6**（2026-11-12）。本文是架构与协议规格；安装步骤见 [docs/INSTALL.md](docs/INSTALL.md)，安全细节见 [docs/SECURITY.md](docs/SECURITY.md)，关键取舍见 [docs/ARCHITECTURE-DECISIONS.md](docs/ARCHITECTURE-DECISIONS.md)，版本历史见 [docs/CHANGELOG.md](docs/CHANGELOG.md)。

## 1. 目标与非目标

**目标**

- 用一个左侧栏入口，在 Windows/macOS/Linux 的 DSH Web 或桌面端查看多台 DSH 的工作状态。
- 覆盖状态总览、节点详情、只读会话概览、任务/告警、日志式事件、基础管理。
- 同局域网零配置；跨网络在没有公网 IP 时也能连（接入码 + 虚拟局域网/IPv6）；有公网 DSH 时可用 Hub 反连。
- 默认安全：令牌分权、控制默认关闭、dry-run/确认/审计、限流与超时。
- 不在 DSH 进程里做重活：探测、发现、Hub 上报都是独立定时器/服务，宿主异常不影响 DSH Web。

**非目标**

- 不重写 DSH 聊天界面；「打开」是跳转到目标 DSH 真实界面（同源时可内嵌）。
- 不代理 DSH 的会话/模型协议；只读会话元数据，不读取对话正文。
- 不做多租户/RBAC（单用户模型，`peer.principal` 只有 owner）。
- 不做系统级操作（进程管理、OS 用户、重启机器）；控制在 DSH/插件层。

## 2. 需求与假设

| 需求 | 实现 |
| --- | --- |
| 多节点 | 节点注册表（最多 64），按 adapter 探测 |
| Windows PC / 云服务器 / 手机 / 浏览器 | 面板是标准 Web UI，响应式；左侧栏固定入口 |
| 状态总览 | 汇总 chips、节点卡片、告警、事件流 |
| 节点详情 | 主机/指标/协议/会话概览/控制/告警/事件 |
| 任务进度 | 通过会话状态（running/idle）与会话列表近似；不读任务正文 |
| 日志 | 节点事件 + 本机事件 + `audit.jsonl` |
| 告警 | 阈值/离线/协议/远端错误；确认与清除 |
| 基础管理 | 增删改节点、探测、启停、批量、令牌/名称 |
| 左栏入口 | `sidebar.panellist` id=node-monitor, order 20 + 同 id `main` 面板 |
| 实时 + 断线 | 面板轮询（4s，可配；页面隐藏暂停；指数退避）；探测定时器 |
| 部署 | profile bundle，单包，无运行时依赖 |

假设：

1. 目标 DSH 版本支持本插件（v0.6.6 宿主半）；不同版本用 `PROTOCOL=dsh.node-monitor/1` 校验，不匹配只告警。
2. 跨节点访问走 agent 端口 45873（插件自己的 HTTP），不依赖 DSH 的 `--host`/登录态。
3. 打开远端 DSH 界面需要其启动登录地址，插件无法自行获取，由用户一次性粘贴。
4. 跨 NAT 的两个节点若都没有公网入口，必须借助第三点（Hub、虚拟局域网或隧道）；纯 P2P 不做。
5. 面板操作者即本机 owner；非 owner 的 RPC 一律拒绝写操作。

## 3. 架构演进

| 版本 | 主题 | 关键能力 |
| --- | --- | --- |
| v0.1 | 单机面板 | 左侧栏入口、自检节点、状态/告警/事件 |
| v0.1.1 | 加载安全 | 非阻塞激活、错误边界、停用开关 |
| v0.2 | Hub 壳 | 网络/备注、登录材料、一次性票据一键打开 |
| v0.3 | 管控 | 只读会话、同源内嵌、运维控制（dry-run/确认/审计）、筛选/分组/告警深链 |
| v0.3.1 | 批量 | 批量探测/启用/停用 |
| v0.4 | 发现 | UDP 广播、令牌确认接入、扫码 |
| v0.4.1 | 配对 | 名称自动补全、双向登记 |
| v0.5 | 零配置 | 自监听 45873、自动互加（只读令牌） |
| v0.6 | 远程主节点 | Hub 反连、命令队列 |
| v0.6.1 | 加入链接 | `#node-monitor-join` + 本地二维码 |
| v0.6.2 | 无服务器 | 接入码 `#node-monitor-add`、IPv6 双栈 |
| v0.6.3 | 安全审计 | 只读令牌分权、命令过期、peer 上限、超时与日志轮转 |
| v0.6.4 | 文档与修复 | 全套文档重写；`remoteId` 持久化，重启后 Hub/直连去重仍有效 |
| v0.6.5 | 文档补充 | 架构决策记录（ADR）与英文 README |
| v0.6.6 | 健壮性修复 | 自动配对限流、Hub 结果绑定、publicUrl/链接校验、SVG 白名单、计数与队列清理 |

## 4. 总体架构

```
┌──────────────────────── 浏览器 ────────────────────────┐
│ sidebar.panellist「节点监控」 + main 面板               │
│   │ ctx.connection.rpc.call('/node-monitor-rpc', ...)   │
└───┼─────────────────────────────────────────────────────┘
    ▼
┌──────────────────────── 宿主插件 ──────────────────────┐
│ NodeMonitorHost                                        │
│  ├─ RPC 分发（owner 校验）                             │
│  ├─ 节点表/告警/事件/审计                              │
│  ├─ 探测调度（每 refreshMs，最多 4s 超时）             │
│  ├─ agent HTTP（45873，双栈）                          │
│  │   status / health / control / pair / hub/push       │
│  ├─ UDP 发现（45871）+ 自动配对 + 单播 peers           │
│  └─ Hub 客户端（可选，3s 出站）                        │
└───┬───────────────┬───────────────┬────────────────────┘
    │ Bearer HTTP   │ UDP broadcast │ Hub push/result
    ▼               ▼               ▼
 其他 DSH         局域网 DSH      远程主节点（公网 DSH）
```

### 4.1 一次状态探测

1. 定时器触发 `probeNode(node)` → `GET {node.baseUrl}/node-monitor/api/v1/status`（Bearer 节点令牌）。
2. `adaptAgentStatus` 校验协议，`sanitizeSnapshot` 白名单清洗；失败记录错误码（auth/timeout/unreachable/http-status/bad-json/protocol-missing）。
3. `probeRecordFromOutcome` 累计失败次数；`classifyProbe` 得出 online/degraded/offline（失败 2 次离线）。
4. `computeAlerts` 生成/延续/清除告警（带稳定 key 与 since）；`summary` 汇总。
5. 面板轮询 `state` 获取统一视图。

### 4.2 自动发现/配对

```
A --UDP announce(id,label,port,ap,version)--> B
B 记录发现条目（不含令牌）
B maybeAutoPair(peer) → POST http://ip:ap/pair {auto:true, token: B.statusToken}
A handlePairRequest: 局域网来源 + 仅只读令牌 → 建节点 tags=[paired,auto]
A 返回 {token: A.statusToken, readOnly:true, agentPort}
B 建节点（baseUrl=http://ip:ap），双方互见（只读）
```

### 4.3 Hub 反连

```
PC 每 3s: POST {hub}/node-monitor/api/v1/hub/push  (Bearer hubToken)
          body {nodeId,name,hostname,version,payload}
Hub:      更新 hubPeers，返回 {commands:[...]}
PC:       执行命令（plugins.list/setEnabled）→ POST /hub/result
Hub:      按 commandId resolve，RPC 返回结果
```

## 5. 模块与目录

| 文件 | 职责 |
| --- | --- |
| `lib/core.js` | 纯逻辑：地址/令牌校验、快照清洗、探测、告警、发现协议、持久化、链接编解码 |
| `lib/index.js` | 宿主：生命周期、RPC、agent HTTP、UDP、配对、Hub、审计、持久化 |
| `lib/client.js` | 浏览器 bundle：左栏图标、面板、商店/store、组件、CSS |
| `lib/qrcode.js` | 内置二维码（qrcode-generator 2.0.4，MIT） |
| `locale/{zh,en}.json` | 插件市场展示元数据 |
| `test/*.test.js` | core 单测 + host 集成（真实 node:http） |
| `docs/` | 安装、安全、版本历史、截图 |

加载顺序（宿主 `apply`）：`enabled` 开关 → 构造 host → `start()`（后台）→ 返回 disposer。`start()` 内部：加载 state/secrets → 绑定 session 事件 → 启动探测定时器 → 1.5s 窗口内挂 RPC/路由（失败重试 5 次）→ 启动 agent HTTP/UDP/Hub 客户端。任何一步失败只降级，不抛给 Loader。

## 6. 数据模型与持久化

目录：`~/.dsh/node-monitor/`（0700）；`state.json`、`secrets.json`、`audit.jsonl`（0600）。

**Node**：`id, name, baseUrl, adapter('dsh'|'generic'|'hub'), path, tags[], enabled, network('lan'|'tailscale'|'tunnel'|'public'|'internet'), notes, remoteId, createdAt, updatedAt`。`remoteId` 用于把 Hub 投影与同机直连节点去重。

**Probe**：`status('ok'|'error'), latencyMs, checkedAt, error{code,message}, failures, snapshot`。

**Snapshot**：`protocol, host{hostname,platform,arch,version,uptimeSec}, sessions{total,running,idle,list[≤20]}, metrics{cpuPct,memPct,memUsedBytes,memTotalBytes,diskFreePct,diskFreeBytes,diskTotalBytes,load1}, control{enabled,restart,actions[]}, alerts[≤20], recent[≤20]`。只读令牌返回 `restrictSnapshot`：`sessions.list=[]`、`recent=[]`、`control` 全关。

**Alert**：`key(=<nodeId>:<code>), nodeId, code, level('critical'|'warning'|'info'), since, message`。确认写入 `acks[key]`。

**Event**：`at, kind, code, level, params`；环形缓冲（eventsLimit）。

**State v1**：`{version, updatedAt, seededSelf, nodes[], settings, acks}`。**Secrets**：`agentToken, statusToken, tokenSource, nodeTokens{}, nodeLogins{}, openSecret, nodeId, hubToken, hubLink{url,token}`；永不进入 state/日志/非 owner 响应。

## 7. 协议规格

### 7.1 面板 ↔ 宿主（Connection RPC）

通道 `/node-monitor-rpc`，`ctx.connection.rpc.handle`；请求载荷 `{}` 或业务对象；响应 `{ok:true,value}` / `{ok:false,error:{code:'node-monitor/<code>',message}}`；写操作要求 `peer.principal.kind==='owner'`。

动作（全部幂等或显式动作）：

| 动作 | 参数 | 返回 |
| --- | --- | --- |
| `state` | — | 完整视图（含 summary/hub/discovery/events） |
| `refresh` | — | 立即探测后 state |
| `addNode` / `updateNode` / `removeNode` | 节点字段 / `{id}` | state |
| `ackAlert` / `ackAll` / `batchNodes` | `{key}` / `{op,ids}` | state |
| `settings` | 部分设置 | state |
| `testNode` | `{id}` 或临时节点 | `{success,latencyMs,snapshot,error}` |
| `setLogin` / `clearLogin` / `openTicket` | `{id,url}` / `{id}` / `{id}` | state / `{url,expiresAt}` |
| `control` | `{id,action,params,dryRun?,confirm?}` | `{status,response}` |
| `hubJoin` / `nodeInvite` | `{}` / `{address?}` | `{link,origin,svg,...}` |
| `hubInfo` / `hubConnect` / `hubDisconnect` / `hubRotateToken` | `{url,token}` / `{}` / `{confirm}` | hub 信息 / state |
| `discoveryProbe` / `selfToken` / `rotateToken` / `updateLabel` | `{confirm}` / `{label}` | state / token / label |

### 7.2 Agent HTTP（45873，兼容 DSH 端口）

| 方法与路径 | 认证 | 语义 |
| --- | --- | --- |
| `GET /node-monitor/api/v1/health` | 无 | `{ok,protocol,name}` |
| `GET /node-monitor/api/v1/status` | Bearer `agentToken`（完整）或 `statusToken`（只读） | `buildAgentPayload` / `restrictSnapshot` |
| `POST /node-monitor/api/v1/control` | Bearer `agentToken` | 需 `allowControl`；动作见 7.6 |
| `POST /node-monitor/api/v1/pair` | Bearer `agentToken`，或 `auto:true`（仅局域网） | 登记调用方（见 7.4） |
| `POST /node-monitor/api/v1/hub/push` | Bearer `hubToken` | 上报 + 领命令 |
| `POST /node-monitor/api/v1/hub/result` | Bearer `hubToken` | `{commandId,ok,value,error}` |
| `GET /node-monitor/open` | 一次性票据 | 302 到节点登录页（60s、nonce 一次） |

限制：body ≤ 16KiB（pair）/64KiB（control）/128KiB（hub push）；读体 20s 超时；按 IP 限流；401 带 `www-authenticate`；`cache-control: no-store`；`nosniff`。

### 7.3 UDP 发现协议

端口 45871，组播 `239.255.43.21` + 广播 + 单播 peers；30s 一次；TTL 5 分钟；最多 32 条。报文：

```json
{"m":"dsh-node-monitor/discovery/1","v":1,"id":"<nodeId>","label":"<显示名>","port":3081,"host":"<主机名>","version":"0.6.6","ap":45873,"path":"/","ts":1699999999999}
```

接收方必须：校验协议/id/来源为 RFC1918/链路本地/回环、忽略自身 id、按 id 去重并刷新 lastSeen。**报文不含任何令牌。**

### 7.4 配对协议

`POST /pair`，body `{id,label,port,agentPort,token,auto?,readOnly?}`；`auto:true` 时跳过 Bearer（仅当 autoPair 开启），并且只能收到只读令牌；正常配对需要 Bearer = 接收方 agentToken。接收方校验局域网来源、限流、按 `http://<源IP>:<agentPort||port>` 去重；新节点 `tags=['paired','auto'?]`；回复 `{ok,token,readOnly,agentPort,label,nodeId,created|updated}`。重复配对只更新令牌与名称。

### 7.5 Hub 反连协议

- PC → Hub `POST /hub/push`，Bearer `hubToken`，body `{nodeId,name,hostname,version,payload}`，每 3s；超时 15s。
- Hub 返回 `{ok,commands:[{id,action,params,dryRun,confirm,expiresAt}],hub:{label}}`；命令 20s 过期，队列每 peer 上限 10。
- PC 执行后 `POST /hub/result` `{commandId,ok,value,error}`；Hub 按 id resolve 挂起的 RPC（20s 超时）。
- Hub 侧 peer 上限 128、7 天过期、记录来源 IP；同一 nodeId 60s 内换 IP 返回 409。
- 投影节点 `id='hub:<nodeId>'`, `adapter='hub'`, `tags=['hub']`；与已知 `remoteId` 相同的直连节点去重。

### 7.6 运维控制

动作：`plugins.list`、`bundles.list`、`plugins.setEnabled`、`restart`（需 `allowRestart`）。语义：

- 默认 `dryRun:true`（读动作除外），真实执行需 `confirm:true`。
- `plugins.setEnabled` 用 Loader `entryId`（带 `patchId` 的条目才可管理）；`restart` 202 后 `process.exit(0)`，由宿主守护进程拉起。
- 每次调用写 `audit.jsonl`：`{ts, action, dryRun, confirm, params, ok, error?}`；>5MB 轮转为 `.1`。
- Hub 反连场景只支持 `plugins.list` / `plugins.setEnabled`；本机 `allowControl` 关闭时拒绝。

### 7.7 链接与二维码

- 加入链接（Hub 客户端用）：`<origin>/#node-monitor-join=<token>`；token 在 `#` 片段，不发送给服务器；面板读取后 `history.replaceState` 清除。
- 接入码（节点添加用）：`<origin>/#node-monitor-add=<base64url({v:1,u:"http://ip:45873",t:"<agentToken>"})>`；面板粘贴到「节点地址」自动解析。
- origin 顺序：`config.publicUrl` → `DSH_NODE_MONITOR_PUBLIC_URL` → `webApp.getAdvertisedUrl()` → `webServer.getOrigin()`。
- 二维码由宿主用内置 `lib/qrcode.js` 生成 SVG（ECC M），不经第三方。

## 8. UI / UX 与左侧栏

- 注册：`ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({name:'sidebar.panellist', id:PANEL_ID, order:20, locale:NS, label:()=>t('panel')}, Icon))`；`ctx.slots.inject('main', () => ctx.slots.register({name:'main', key:PANEL_ID, locale:NS}, Panel))`。
- 图标由 24×24 SVG 绘制，状态色画在 SVG 内部（红=critical/offline，黄=告警/异常，绿=在线，灰=未知）；owner props `{size, active}`。
- 面板：`PanelBoundary` 捕获渲染异常，降级为「本面板错误 + 刷新」，不牵连宿主。
- 轮询：成功按 `refreshMs`，失败 2.5s→30s 退避；`document.hidden` 时 2.5s；恢复可见立即刷新；`mutate` 后清空选择/收起弹窗。
- 深色/浅色主题只用 `--dsw-alias-*` token；≤760px 单列，弹窗 sheet 化，内嵌全屏。

## 9. 安全模型

信任边界：

```
owner（DSH Cookie） ──RPC──▶ 宿主
匿名 agent ──Bearer──▶ health/status(只读)/pair(局域网)
持有 agentToken ──Bearer──▶ control / 完整 status
持有 hubToken ──Bearer──▶ hub/push/result
```

- 令牌矩阵见 README / SECURITY；自动配对只交换 `statusToken`；自动节点只读。
- 控制默认关闭；`allowControl`/`allowRestart` 需显式开启；`restart` 必须 confirm。
- 入站请求：局域网来源校验（pair）、限流（普通 240/min、失败 20/min）、body 上限、20s 读超时、`no-store`/`nosniff`。
- 出站探测：只允许 http/https、拒绝重定向、4s 超时、响应 ≤512KiB、不接受用户可控的任意方法。
- 信息暴露：会话只给 ID/状态/模型/cwd/时间，不给正文、提示词、工具输出；令牌只在 owner 显式请求时返回（`selfToken`/`hubInfo`）。
- 审计：控制动作双写（执行前/后），Hub 命令结果也落审计。

## 10. 部署与运维

| 拓扑 | 需要开放 | 说明 |
| --- | --- | --- |
| 单机/局域网 | TCP 45873、UDP 45871 | 无需 DSH `--host`；Windows 防火墙放行 |
| Hub（旧电脑/NAS/VPS） | 入站 TCP 45873（或反代） | PC 只出站；Hub 面板在本机打开 |
| 无服务器 | TCP 45873 + 虚拟网 | Tailscale/ZeroTier/IPv6；接入码一条链接 |
| 域名反代 | 443 → DSH 3081 | 配 `publicUrl`，agent 端口可选 |

运维要点：升级=tarball 重装+重启；回滚=旧 tag；备份 `state.json`/`secrets.json`；令牌轮换会级联失效已配对节点；`audit.jsonl` 5MB 轮转；Hub 重启后 peer 需等 3s 重报（未持久化）。

## 11. 兼容与迁移

- 协议版本 `dsh.node-monitor/1`；不匹配只告警并降级显示。
- v0.6.2 旧节点与 v0.6.3 混用：旧节点自动配对时会收到/保存只读令牌，看到的状态会少会话明细；升级两端恢复。
- 旧版自动配对曾保存完整令牌；升级 v0.6.3 后建议轮换连接令牌，旧令牌立即失效。
- 从 v0.5 及更早升级：需重启 DSH 才有 45873 与 Hub/接入码能力。
- 状态文件 v1 向后兼容；`remoteId` 为新增可选字段，旧文件缺失时按 null 处理。

## 12. 测试与验收

测试（`npm test`，50/50）：

- **core 30**：地址/令牌校验、快照清洗与只读快照、探测与错误码、告警计算、发现报文解析/合并、链接编解码、持久化往返。
- **host 20**：RPC 与 owner 校验、agent 认证/只读/401、pair 双向/去重/公网拒绝、自动配对只读、Hub 上报与命令往返、Hub 投影去重、Hub 结果必须匹配 nodeId、自动配对限流/自动节点上限/publicUrl 校验、控制 dry-run/confirm/审计、发现报文注入、加入链接/二维码、exclude 令牌泄露。

验收清单：

- [x] 左侧栏入口与主面板
- [x] 多节点状态/详情/会话/告警/事件
- [x] 本机自检、添加/编辑/删除、测试连接
- [x] 只读令牌与完整令牌分权
- [x] 局域网零配置互加
- [x] Hub 跨网反连 + 命令往返
- [x] 加入链接/接入码 + 二维码
- [x] 响应式（390×844）与 0 console error
- [ ] 接入码有效期（计划）
- [ ] Hub peer 持久化（计划）

## 13. 已知限制与路线图

**限制**

1. 跨公网无公网入口时必须有第三点（Hub/VPN/隧道），纯 P2P 不做。
2. 打开远端完整 DSH 界面依赖其启动登录地址，插件拿不到；同源才可内嵌。
3. Hub peer 列表只在内存，Hub 重启后需等 PC 下次上报。
4. 会话概览只有元数据（ID/状态/模型/cwd/时间），不读正文与任务输出。
5. 单用户模型，没有 RBAC；面板操作者即 owner。
6. `restart` 在 Hub 反连模式不支持（会断连），需要本机 allowRestart + 直连。

**路线图**

- 接入码有效期（默认 10 分钟）与一次性使用
- Hub peer 持久化、断线补发
- 通知通道（Webhook/IM）与静默时段
- 只读会话时间线 / 任务进度细分
- 多用户与操作审批
- npm 发布、市场收录后的更新提示

## 附录 A：配置与环境变量

| 配置 | 环境变量 | 默认 | 说明 |
| --- | --- | --- | --- |
| `home` | `DSH_HOME` | `~/.dsh` | 数据目录 |
| `label` | — | 主机名 | 发现显示名 |
| `discovery` | `DSH_NODE_MONITOR_DISCOVERY=0` | true | 关闭 UDP 发现 |
| `discoveryPort` | `DSH_NODE_MONITOR_DISCOVERY_PORT` | 45871 | 发现端口 |
| — | `DSH_NODE_MONITOR_DISCOVERY_PEERS` | — | 单播 peers `host:port,...` |
| `agentPort` | `DSH_NODE_MONITOR_AGENT_PORT` | 45873 | agent 端口 |
| `publicListen` | `DSH_NODE_MONITOR_PUBLIC_LISTEN=0` | true | 是否对外监听 |
| `autoPair` | `DSH_NODE_MONITOR_AUTO_PAIR=0` | true | 自动互加 |
| `allowControl` | `DSH_NODE_MONITOR_ALLOW_CONTROL=1` | false | 插件启停 |
| `allowRestart` | `DSH_NODE_MONITOR_ALLOW_RESTART=1` | false | 远程重启 |
| `hub` | `DSH_NODE_MONITOR_HUB=0` | true | 接受 Hub 上报 |
| `publicUrl` | `DSH_NODE_MONITOR_PUBLIC_URL` | — | 对外 origin |

## 附录 B：错误码

`invalid-name`、`invalid-url`、`invalid-adapter`、`invalid-token`、`limit-reached`、`not-found`、`disabled`、`forbidden`、`control-disabled`、`control-action-invalid`、`control-confirm-required`、`control-restart-disabled`、`control-unavailable`、`login-url-invalid`、`open-invalid`、`open-expired`、`peer-conflict`、`peer-limit`、`batch-invalid`、`batch-empty`、`batch-too-many`、`auth`、`timeout`、`unreachable`、`http-status`、`bad-json`、`protocol-missing`、`remote-unhealthy`、`unknown-endpoint`、`rate-limited`、`unauthorized`、`body-too-large`、`bad-json`。
