# dsh-node-monitor 设计文档

> 适用版本：**v0.7.3**（2026-11-15）。本文是架构与协议规格；安装步骤见 [docs/INSTALL.md](docs/INSTALL.md)，安全细节见 [docs/SECURITY.md](docs/SECURITY.md)，关键取舍见 [docs/ARCHITECTURE-DECISIONS.md](docs/ARCHITECTURE-DECISIONS.md)，版本历史见 [docs/CHANGELOG.md](docs/CHANGELOG.md)。

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

1. 目标 DSH 版本支持本插件（v0.7.1 宿主半）；不同版本用 `PROTOCOL=dsh.node-monitor/1` 校验，不匹配只告警。
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
| v0.7.1 | 排查支持 | 探测并发 6、重复地址合并、`/diagnose` 诊断端点、堆超限告警日志 |
| v0.7.2 | 零参数体验 | 本机节点自愈、`addSelf`/`pairDiscovered` RPC、添加表单基础/高级分层、发现列表一键自动接入 |
| v0.8.0 | 全网互联 | 主节点下发对端摘要、PC 投影 `relay:` 节点、`hub/relay` 中继控制、`relayControl` RPC |
| v0.7.3 | 连接体验 | 令牌显示切换与容错匹配、内置填写示例、跨网络措辞、远程界面说明与登录材料引导、打开拦截对话框 |

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
{"m":"dsh-node-monitor/discovery/1","v":1,"id":"<nodeId>","label":"<显示名>","port":3081,"host":"<主机名>","version":"0.6.8","ap":45873,"path":"/","ts":1699999999999}
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

测试（`npm test`，51/51）：

- **core 30**：地址/令牌校验、快照清洗与只读快照、探测与错误码、告警计算、发现报文解析/合并、链接编解码、持久化往返。
- **host 21**：RPC 与 owner 校验、agent 认证/只读/401、pair 双向/去重/公网拒绝、自动配对只读、Hub 上报与命令往返、Hub 投影去重、Hub 结果必须匹配 nodeId、自动配对限流/自动节点上限/publicUrl 校验、控制 dry-run/confirm/审计、发现报文注入、加入链接/二维码、重复地址合并、诊断端点、exclude 令牌泄露。

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

## 15. 界面重设计（v0.7.1）

## 15. 界面重设计（v0.7.1）

- 目标：把「所有配置摊在首页」改成「顶部工具条 + 设置抽屉」，降低首屏噪声，移动端优先。
- 结构：`nm-head`（sticky/移动端 static）内放标题、`⟳`、`+ 连接设备`、`⚙ 设置`；`Overview` 只渲染告警、筛选/批量、节点卡、最近活动；`SettingsDrawer` 为右抽屉（移动端全屏），两 tab（连接/通用）。
- 组件迁移：`SelfPanel`、`HubPanel`、`DiscoveryPanel` 从 Overview 移入抽屉；`SettingsModal` 保留，由「通用」打开；版本/升级在「连接」与「通用」两处可达。
- 节点卡：`CardMetric` 三列网格（标签+数值+细进度条），移动端单列；`打开/内嵌/编辑` 在窄屏只保留「打开」与「⋯」。
- 可访问性/降级：抽屉有 scrim 点击关闭与 ✕；设置入口用按钮不依赖 hover；无 JS 构建，仍为单文件 bundle。
- 测试：客户端改动不影响单测；`npm test` 53/53；Playwright 断言 `.nm-drawer` 出现/关闭、4 tab 可切换、主区 `.nm-self` 为 0、控制台 0 error。

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

## 14. 插件内升级（v0.7.1）

- **来源**：`GET https://api.github.com/repos/qingshuiliuyun/dsh-node-monitor/tags?per_page=30`，取 semver 最大 tag；5 分钟缓存；失败返回 `error` 不阻塞面板。
- **RPC**：
  - `upgradeCheck`（owner）→ `{current, latest, updateAvailable, url, install:{version,source,linked}|null, checkedAt, enabled, error}`。
  - `upgradeApply`（owner）→ 校验 `version` 严格 `x.y.z` 且大于当前版本；读 `listBundles()` 发现 `link:` 安装直接拒绝（`upgrade-linked`）；否则 `pluginManager.installBundle(<codeload tag tarball>)`，返回 `{target,spec,result}`。
- **UI**：版本行 + 检查按钮；有更新时两步确认后显示“升级已提交，重启 DSH 后生效”。
- **安全**：仅 owner；版本号白名单；链接固定到官方仓库；关闭开关 `selfUpgrade:false`/`DSH_NODE_MONITOR_SELF_UPGRADE=0`。


## 16. 全自动与本机节点（v0.7.2）

- **本机节点自愈**：`ensureSelfNode()` 在 `attachWeb` 完成与每个 `tick()` 调用；按 `tags` 含 `self` 查找，存在则校正 `baseUrl` 为当前 `safeOrigin()`（DSH 端口变化自动跟随），不存在则用 `makeSelfNode()` 创建。旧逻辑只在「首次且节点列表为空」时创建，用户先加远端节点或启动时 origin 未就绪就永久缺失。
- **RPC**：`addSelf`（owner）→ `ensureSelfNode` + `saveNow` + 返回 state；`pairDiscovered`（owner）→ 按 id 查当前发现条目，调用 `tryAutoPair`（仅交换 `statusToken`，只读），成功后返回 state，失败映射 `discovery-not-found`/`discovery-no-port`/`pair-failed`。
- **UI 简化**：NodeModal 只展示 名称/地址/令牌，其余收进 `<details>`「高级选项」；空态提供「添加本机节点」；发现条目提供「自动接入」（无需令牌）与「手动填写」；设置抽屉连接页提供「添加/修复本机节点」；副标题与提示文案说明自动行为。
- **发现地址**：快照增加 `agentAddress`（`http://host:agentPort`），列表直接显示可探测的 agent 地址，而不是 DSH 网页端口。
- **测试**：`test/core.test.js` 31、`test/host.test.js` 23（新增本机节点自愈/恢复/端口跟随），合计 54/54。


## 17. 连接体验修正（v0.7.3）

- **令牌容错**：`core.tokenVariants()` 归一化（trim、去空格/连字符、大写回退），`core.tokenEquals()` 在 agent/status/hub 令牌校验处替代严格比较；生成仍保留可读的 `XXXX-XXXX-XXXX`。
- **密码可见**：`PasswordInput` 统一组件（右置显示/隐藏按钮），用于节点连接令牌、登录材料、Hub 加入令牌。
- **填写引导**：添加节点弹窗默认展开「怎么填？看这里（含示例）」，四段说明（同 Wi-Fi / 不同网络地址示例 / 令牌来源 / 名称），地址占位符改为真实示例。
- **措辞**：`远程` 改为 `跨网络`（tab、Hub 标题、节点标签、网络说明），并解释「不在同一 Wi-Fi 时使用」。
- **打开语义**：节点详情新增「远程 DSH 界面」：未配置登录材料时显示说明与「填写登录材料」，配置后才显示「打开」；本机节点例外（同源 cookie 可直接打开）。
- **打开失败可见化**：`openNode` 在弹窗被拦截、宿主过旧、缺登录材料时分别弹出 `LinkDialog`（打开新标签 / 复制链接）或直接进入登录材料编辑，不再静默失败。
- **测试**：54/54；令牌容错、界面断言通过；无协议变更。


## 18. 统一主节点：全网互联（v0.8.0）

- **目标**：所有 PC 连同一个 Hub 后，每台 PC 都能看到全部节点（星型控制面、逻辑全网），而不是只有 Hub 能看到所有 PC。
- **Hub 侧**：
  - `handleHubPush` 响应增加 `peers: hubPeerSummaries(nodeId)`：其他最近 60 秒上报的 peer（`nodeId/name/hostname/version/role/online/lastSeen/metrics/sessions`）+ Hub 自己（`role:'hub'`），最多 64 条；不包含任何令牌。
  - `hubPeerSummaries` 只保留 60 秒内有上报的节点，避免离线节点长期残留。
  - 新增 `POST /node-monitor/api/v1/hub/relay`（`handleHubRelay`，Bearer `hubToken`）：`validateHubRelay` 校验目标与动作（`plugins.list` / `plugins.setEnabled`，不支持 `restart`），复用 `controlHubNode` 命令队列→推送→结果回传链路，返回 `{ok:true,value:<目标结果>}` 或 `{ok:false,error}`。
- **PC 侧**：
  - `pushHubOnce` 把响应 `peers` 存入 `this.hubMeshPeers = core.sanitizeHubPeers(...)`（白名单字段）。
  - `meshNodes()`：过滤 `nodeId === 自己` 或已被局域网直连节点 `remoteId` 覆盖的 peer，生成 `id:'relay:<nodeId>'`、`adapter:'relay'`、`tags:['relay']`（Hub 为 `['relay','mesh-hub']`）的只读卡片；`hubPeerSummaries` 的 Hub 条目也会出现为「主节点」卡片。
  - `meshProbeRecord`：用 peer 的 metrics/sessions 合成快照；Hub 节点不暴露控制，其他 relay 节点暴露 `plugins.list`/`plugins.setEnabled`。
  - `controlNode` 对 `relay:` 前缀分流到 `relayControl`，经 Hub `/hub/relay` 转发；`relayControl` RPC（owner-only）返回目标节点的 `{ok,value|error}`。
- **UI**：卡片标签「经主节点」「主节点」；relay 卡片隐藏打开/内嵌（无登录材料且非同源）；详情页运维控制带提示「该节点经主节点转发，操作由主节点代发」。
- **安全**：relay 控制要求持有 Hub 的 `hubToken`；Hub 侧仍按 `CONTROL_ACTIONS` 白名单与 confirm/dryRun 门禁；relay 节点不进入 `computeAlerts`，避免离线告警噪音。
- **测试**：core 33（新增 `validateHubRelay`、`sanitizeHubPeers`），host 24（新增「统一主节点：PC 看到全网节点，并经主节点转发控制」，含 fake Hub HTTP + relay 控制往返），合计 57/57。
- **限制**：mesh 卡片 3 秒级状态、不代理完整 DSH 协议；relay 控制不支持 restart；同一 nodeId 冲突由 Hub 的 60 秒 IP 绑定缓解。

## 19. 局域网桥接与远程界面（v0.9.0）

### 19.1 目标

- 同一局域网内，只要有一台节点连上 Hub，其余节点无需再配置 Hub 令牌即可获得全网视图与转发控制。
- 应用内提供远程 DSH 界面入口。

### 19.2 桥接协议

- 配对响应新增 `bridge:{available,label,through}` 与 `bridgeToken`（随机 18 字节 hex，secrets.bridgeTokens，0600）。
- 未连 Hub 的局域网节点每 3s `POST /node-monitor/api/v1/bridge/push`（Bearer bridgeToken）；桥接端有 hubLink 则转发 `/hub/push`，自身为 Hub 则写入 `hubPeers`；响应带 `peers`。
- 控制经 `POST /node-monitor/api/v1/bridge/relay` 转发到 Hub `/hub/relay` 或本机 `controlHubNode`，动作限制同 Hub 中继（不支持 restart）。
- 关闭：`DSH_NODE_MONITOR_BRIDGE=0` 或 `config.bridge=false`。

### 19.3 远程界面

- 注册第二个 `sidebar.panellist`（`node-monitor-remote`）与同名 `main` 面板。
- 候选：本机（直接 baseUrl）或已配置登录材料的远端节点；远端通过 `openTicket` 票据 URL，iframe 指向 `/node-monitor/open?...`，宿主 302 到远端带 token 启动地址。
- 同站可内嵌；跨站（DSH Cookie SameSite=Strict）需新标签或同域反代。
- `sidebar.workspaces` 为宿主独占 single slot，插件不可追加，故使用并列一级入口。

### 19.4 限制

- 桥接依赖一台常开的 Hub 客户端；离线时退回本机视图。
- 远程界面需登录材料；未配置时引导去节点详情。
- 同域反代需子域名与证书，由部署方配置。

## 20. 术语与命名（v0.12.1）

界面统一用词与宿主字段的对应关系：

| 界面名称 | 宿主字段/存储 | 权限与用途 |
|---|---|---|
| 连接令牌 | `secrets.agentToken` | 完整权限：`/status`、`/pair`、`/control`、`/bridge/*` |
| 只读令牌 | `secrets.statusToken` | 自动配对只读：`/status` 精简、`/control` 拒绝 |
| 加入令牌 | `secrets.hubToken` | Hub 端：`/hub/push`、`/hub/query`、`/hub/relay` |
| 桥接令牌 | `secrets.bridgeTokens[nodeId]` | 局域网未连 Hub 的节点经邻居转发 |
| 连接码 | `shortId` + `agentToken`，不入库 | 一次性粘贴，解析为节点 ID 再查找 |
| DSH 登录链接 | `secrets.nodeLogins[nodeId]` | 只用于 302 打开对方网页，不参与连接 |

约束：令牌只存在宿主侧 0600 文件；RPC 的 `state` 永不包含令牌，只有显式 `selfToken`/`hubInfo` 返回；界面沿用「连接令牌 / 加入令牌 / 连接码 / DSH 登录链接」四个词，不再使用「代理令牌」「登录材料」。

## 21. 连接拓扑（v0.13.0）

**目标**：在第一个标签「节点监控」里用一张图回答“谁连着谁”，而不是只罗列卡片。

### 21.1 布局算法

- 输入：`buildState().nodes`（本机、局域网直连、Hub 投影、中继节点）与探测记录。
- 去重：同一 `baseUrl` 只画一次（中继按 `id`），避免历史重复节点堆叠。
- 选中心：有 `mesh-hub` 标签的节点（PC 连了 Hub）→ 中心是该 Hub；否则本机为中心。
- 分层：
  - 中心 — 本机（PC 视角，实线）；
  - 中心 — 其它 Hub 对端（实线，`adapter=hub|relay`）；
  - 本机 — 局域网节点（虚线，`adapter=dsh|generic` 且非中继），沿本机左侧聚成一簇。
- 环半径：中继 255×118，局域网簇 108（>3 个时 +42，并隔项 +46 错开标签）。
- 自适应：`H = clamp(250, 360, 120 + 叶子数×60)`，节点越多图越高；坐标 clamp 在 110..690 / 52..(H-44)，避免标签出框。
- 标签：超过 18 字符截断；重名节点追加端口（局域网）或节点 ID 前 8 位（中继/Hub）。

### 21.2 交互与状态

- 点节点（鼠标/键盘 Enter）→ `openDetail(node.id)`；中心与叶子一致。
- 状态点颜色复用节点状态（在线/不稳定/离线/未知），图例固定在图底部。
- 数据每 3s 随 `state` 更新，不额外请求；节点数变化触发一次重排。
- 移动端：SVG `min-width:640px`，外层横向滚动，挂载/节点数变化时自动居中到主节点。

### 21.3 限制

- 拓扑只表达**连接关系与状态**，不表达流量/延迟权重；延迟在节点卡片与详情里看。
- 局域网节点在 Hub 视角下也会出现（同一台机器既可能被 Hub 直接发现，也可能经 Hub 中继），按 `baseUrl` 去重后只保留直连那条。
- 超过 64 个节点时只画前 64 个（与 Hub 上限一致）。

### 21.4 测试与验证

- `npm test` 64/64；拓扑为纯客户端渲染，不新增 RPC。
- 实机三节点（Hub + 2 PC）：Hub 视角 `3 nodes / 2 edges`、PC 视角 `3 nodes / 2 edges`，点击叶子进入详情，0 console error。
- 截图：`docs/screenshots/topology-hub.png`、`topology-pc.png`、`topology-mobile.png`。

## 22. 跨网络面板与令牌可见性（v0.13.1）

- 问题：A/B 两个方向共用一个表单，用户不知道地址填主节点还是本机；令牌与连接码默认打码，导致“只能重新生成”，一按就断开已连接设备。
- 方案：`HubPanel` 拆成两张带序号的卡片：
  - A「本机当主节点」：加入地址、加入令牌（默认明文，隐藏/复制/重新生成）、加入链接、二维码、已接入数；
  - B「本机当子节点」：主节点地址 + 加入令牌（带 label），连接/断开。
  - 顶部一句 `两台电脑二选一：主节点用 A，子节点用 B`。
- 默认可见：`hubReveal` 初始 true；SelfPanel 挂载即取令牌（`revealToken`），连接令牌与连接码默认明文，行内提供 隐藏/复制；仍保留“重新生成”但带确认提示。
- 文案：`token.hint` 改为“可随时查看/复制”；面板标题改为「跨网络（主节点 ↔ 子节点）」，A 卡注明“只在主节点电脑上用”。
- 测试 64/64；截图 `docs/screenshots/roles.png`、`token-visible.png`。

## 23. 「添加节点」与「跨网络」的边界（v0.13.2）

- 两种入口语义不同：`添加节点` = 点对点 `nodes[]` 一台；`跨网络` = hub 关系或 hub 模式，PC 通过 `/hub/push` 投影出所有 peer。
- UI：NodeModal 顶部新增 `.nm-scope-note`（虚线框 + 说明 + 「打开连接设备」按钮，调用 `closeModal(); openConnect('hub')`）；HubPanel B 卡说明“连接后自动出现该主节点下的所有电脑，不用逐台添加”。
- 目的：消除“跨网络不就是添加节点吗”的误解，减少用户在主节点网络场景下逐台添加。

## 24. 统一连接入口（v0.14.0）

- 入口合并：顶部 `+ 连接设备` 打开 `ConnectDialog`（720px），内含三个标签：同一网络（发现列表 + 一键接入）、主节点网络（复用 `HubPanel` A/B 卡）、手动直连（连接码 + 打开手动表单）。
- 设置抽屉只保留「连接 / 通用」；原「跨网络」「发现」标签移除，设置连接页新增「连接设备」按钮。
- 同一网络路径最短：`st.data.discovery.nodes` → `pairDiscovered(entry)` 一次调用完成接入；发现的 `agentAddress` 优先于 DSH 端口。
- 状态：`st.connectTab`（默认 lan）、`openConnect(tab)` / `setConnectTab`；`modal.type='connect'` 与编辑弹窗共存。
- 测试 64/64；截图 `connect-lan.png` / `connect-hub.png` / `connect-single.png`。

## 25. 术语与入口一致性审核（v0.14.1）

- 删除「跨网络 / 发现」两个设置标签后，审计客户端全部文案与按钮调用：
  - `modal.scopeHint/scopeAction`、`hub.title/hub.tokenPlaceholder`、`node.hubTag`、`open.hubHint`、`empty.add`、`open.needLogin`、`self.hint`、`invite.hint` 统一指向「连接设备」的三个标签；
  - 手动表单的「打开连接设备」改为 `closeModal(); openConnect('hub')`，不再打开已删除的抽屉 tab；
  - 「同一网络」按 host 匹配现有节点，已接入的条目显示「已接入」，避免重复添加；
  - 设置抽屉「连接设备」按钮先关抽屉再开弹窗，避免两层遮罩叠加。
- 文档：README 术语表、§3 步骤、连接码/桥接/连接细节、界面说明、截图列表；INSTALL 步骤 3；DESIGN 结构段（两 tab）。
- 验证脚本 `audit.js`：面板文本「跨网络」计数 0；「打开连接设备」后 active tab 为「主节点网络」；移动端 390×844 弹窗三标签可用；0 console error。

## 26. 跨网访问地址（v0.15.0）

- 问题：`hubBaseUrl()` 之前用 `publicUrl || safeOrigin(ctx)`，未设 `DSH_NODE_MONITOR_PUBLIC_URL` 时得到 `http://127.0.0.1:3081`，这个地址只在本机有效。
- 方案：A 卡增加「跨网访问地址」输入与保存；宿主新增 `hubSetOrigin({url})`（owner）：
  - 空值清除；非空必须匹配 `^https?://[^\s/]+`，否则 `origin-invalid`；
  - 保存到 `secrets.publicUrl`（0600），`hubBaseUrl()` 顺序为 `secrets.publicUrl → publicUrl(env/config) → safeOrigin`；
  - `hubJoin`/`hubInfo` 随之返回新地址，加入链接与二维码同步变化。
- 客户端：检测 `127.0.0.1/localhost/10./192.168./172.16-31.` 时显示警告与输入框；保存后刷新 `hubInfo/hubToken` 并 toast。
- 测试：host 新增保存/清除/非法/无权 4 组断言；65/65。截图 `docs/screenshots/public-address.png`。
