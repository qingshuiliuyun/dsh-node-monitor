# 跨平台多 DSH 节点互联监控插件 — 架构与实施方案

> 交付物：可安装的 DSH 原生 bundle `dsh-node-monitor`。本文档覆盖需求假设、总体架构、数据流、接口与数据模型、多端 UI/UX（含左侧栏入口）、安全、部署运维、实施计划、测试与验收。
>
> 代码入口：宿主 [lib/index.js](./lib/index.js)，纯逻辑 [lib/core.js](./lib/core.js)，浏览器面板 [lib/client.js](./lib/client.js)，使用说明 [README.md](./README.md)。

---

## 1. 需求与假设

### 1.1 目标拆解

| 原始诉求 | 落地方式 |
| --- | --- |
| 连接多个 DSH 节点 | 每个节点装同一插件，宿主侧节点注册表 + 周期 HTTP 探测；节点间不需要互相直连 |
| Windows PC + 云服务器 | 同一份 Node 侧代码，Windows 与 Linux 通用；地址可为 `http://host:3081` 或 HTTPS 域名 |
| 手机 / PC / 浏览器统一查看 | 面板是 DSH Web 的原生 `main` 面板，任何打开 DSH Web 的终端（含手机浏览器）都能用；响应式断点 760px |
| 左侧栏入口固定 | 注册原生 `sidebar.panellist` 图标（order 20），与 `main` 面板同 id，点击即切面板；侧栏宽度收起时仍显示图标与状态色点 |
| 状态总览 | 汇总 chips（节点/在线/异常/离线/告警）+ 节点卡片 + 告警列表 + 最近活动 |
| 节点详情 | 指标条、主机信息、探测延迟、节点告警、最近事件、探测/编辑/移除 |
| 任务进度 | 通过 DSH `agents` 服务统计运行中/空闲会话数（`sessions.running/total`），并按节点展示；这是当前 DSH 公开的稳定进度信号 |
| 日志 | 节点上报最近活动（事件环形缓冲）+ 面板「最近活动」；宿主的插件日志写入 DSH 日志 |
| 告警 | 宿主侧规则推导（离线/不稳定/协议不一致/延迟/CPU/内存/磁盘/远端自定义），稳定 key + 确认（ack）+ 条件恢复自动清除 ack |
| 基础管理 | 添加/编辑/启用停用/移除节点、令牌管理、阈值设置、立即探测、连接测试 |
| 多端实时 | 宿主周期采集 + 面板短轮询；可见性感知、指数退避、断线降级 |

### 1.2 显式假设（DSH 接口不明确处）

1. **DSH 本体不提供跨实例的标准监控协议**。因此本插件定义自己的节点协议 `dsh.node-monitor/1`，并在插件内做协议协商；不同 DSH 版本/不同实现通过「适配器」接入，而不是假设它们同构。
2. 每个节点在 DSH Web 的 **同一个 HTTP 监听端口**上暴露 agent 端点（默认 3081）；反向代理需把 `/node-monitor/*` 与 `/` 一起转发。
3. 节点之间网络可达（浏览器只访问当前 DSH，跨节点探测全部由宿主发起，不依赖浏览器直连）。
4. 当前 DSH 的 `agents` 服务能提供 `list()` 与 `status: 'idle' \| 'running'`，这是「任务进度」的可信最小集；更细的任务队列（如子代理、待办、工具调用次数）作为后续扩展。
5. 面板的读接口对所有已认证的 DSH 主体开放；**写操作（增删改、确认告警、改设置）限定 owner**（`peer.principal.kind === 'owner'`）。
6. 时间统一用 ISO 8601 UTC 字符串传输，前端按浏览器本地时区相对显示。

### 1.3 待确认项与适配方案

| 待确认 | 当前实现 | 后续可扩展 |
| --- | --- | --- |
| 远端 DSH 是否允许自定义路由 | 走 `webServer.register` 原生路由，不经 DSH 鉴权，插件自己校验 Bearer | 若被网关统一鉴权，可改为签名 header 或 mTLS |
| 节点是否在内网/NAT 后 | 支持反向代理与子路径（`baseUrl` 可带路径） | 可选「反向隧道」模式：节点主动上报，宿主只做接收 |
| 不同 DSH 版本的会话字段 | 只用 `id / status / options` 等稳定字段，未知字段丢弃 | 版本化 `capabilities` 字段，按能力渲染 |
| 移动端推送 | 手机浏览器打开即用；不做系统级推送 | PWA / Web Push / Telegram 等通知通道 |

---

## 2. 总体架构

### 2.1 部署拓扑

```text
┌─────────────── 任一终端（PC / 手机 / 浏览器）───────────────┐
│  DSH Web 前端（React）                                      │
│  ├─ sidebar.panellist 图标：节点监控（状态色点）             │
│  └─ main 面板：总览 / 详情 / 告警 / 设置                     │
│         │ 短轮询 state（Connection RPC，会话 cookie 认证）   │
└─────────┼──────────────────────────────────────────────────┘
          │
┌─────────▼──────────────────────────────────────────────────┐
│  DSH 节点 A（本机，如 Windows PC 或云服务器）                │
│  dsh-node-monitor 宿主插件                                  │
│  ├─ NodeMonitorHost：节点注册表 / 采集器 / 告警引擎 / 持久化 │
│  ├─ Connection RPC：/node-monitor-rpc（认证、owner 校验）    │
│  └─ Agent HTTP：/node-monitor/api/v1/{status,health}         │
└─────────┬──────────────────────────────────────────────────┘
          │  HTTP(S) GET + Authorization: Bearer <agentToken>
          │  周期探测（并发、超时、限流、重定向禁止）
┌─────────▼───────────────┐   ┌───────────────────────────────┐
│  DSH 节点 B（云服务器）  │   │  非 DSH 服务（generic 适配器） │
│  同插件 + 相同的令牌     │   │  GET /health → JSON 健康契约   │
└─────────────────────────┘   └───────────────────────────────┘
```

**关键点：面板永远只连接「当前 DSH」**。跨节点流量是服务器到服务器（S2S），手机端不持有任何节点令牌，不直连远端，避免把令牌暴露给浏览器和移动网络。

### 2.2 逻辑分层

```text
┌─────────────────────────── 浏览器 ───────────────────────────┐
│ client.js                                                    │
│  store（轮询/退避/可见性） → React 视图（Icon/Panel/Modal）    │
└───────────────────┬──────────────────────────────────────────┘
                    │ Connection RPC（已认证通道）
┌───────────────────▼──────────────────────────────────────────┐
│ index.js · NodeMonitorHost                                    │
│  RPC 端点层 → 业务层（节点/告警/设置/测试） → 采集层（tick）    │
│                                ↘ 持久化层（state.json/secrets）│
├───────────────────────────────────────────────────────────────┤
│ core.js（纯函数）                                             │
│  校验 · URL 归一 · 探测解析 · 适配器 · 状态归并 · 告警 · 清洗  │
└───────────────────┬──────────────────────────────────────────┘
                    │ HTTP(S) + Bearer
┌───────────────────▼──────────────────────────────────────────┐
│ 各节点的 agent 端点 / 任意 generic 健康端点                    │
└──────────────────────────────────────────────────────────────┘
```

### 2.3 为什么不用 Typert Remote / 不直推 WebSocket

- Typert Remote 需要额外宿主插件行与手写 codec，本 profile 的 HMR 安装路径会引入不可控的重建风险；改用 **DSH 官方已认证的 Connection RPC**，鉴权、路由、会话由宿主完成，插件只处理业务，安全性更高。
- 跨节点若用 WebSocket，需要每个节点主动连接受控网关，部署与网络穿透成本高；当前以 **宿主拉取 + 面板短轮询** 达到「近实时」，并用可见性/退避控制开销。若未来需要 <1s 实时，可在 agent 端点加 SSE，或在宿主与面板之间复用 `shell.overlay` 之外的推送通道。

### 2.4 数据流

1. 面板 `apply` 后创建 store，立即 `state`，随后按 `settings.refreshMs` 轮询；失败指数退避（2.5s→30s），页面隐藏时 2.5s 轻轮询，恢复可见立即刷新。
2. 宿主 `tick()` 每 `refreshMs` 对启用节点并发 `probeNode`（同一节点有 inflight 去重）。
3. `probeEndpoint`：构造目标 URL（dsh → `/node-monitor/api/v1/status`，generic → 节点自定义 path），带 Bearer、超时 AbortController、`redirect: 'error'`、响应大小上限。
4. 适配器解析：`dsh` 校验 `protocol`，版本不一致仍保留可用字段并标记 `protocolMismatch`；`generic` 接受最小健康契约。
5. `sanitizeSnapshot` 白名单清洗（主机/会话/指标/告警/最近活动），确保远端任意字段不会透传到浏览器。
6. `probeRecordFromOutcome` 累计失败次数；`classifyProbe` 得出 `online/degraded/offline`；状态跃迁写事件。
7. `computeAlerts` 每轮从「节点 + 探测 + 阈值」重新推导，key 稳定为 `<nodeId>:<code>`，`since` 保留首次出现时间；`acks` 只对仍存在的告警生效，条件恢复即清除。
8. 面板拿到 `{summary, nodes, probes, alerts, events, settings, token, server}` 渲染；告警确认、节点编辑等写操作回传后直接返回新 state，避免二次请求。

---

## 3. 模块边界与目录

```text
dsh-node-monitor/
├─ package.json          # bundle 清单：dsh.bundle.patch / dsh.client / exports
├─ cordis.patch.yml      # 唯一宿主插件行 node-monitor
├─ icon.svg              # 插件图标（插件元数据）
├─ locale/
│  ├─ zh.json            # meta.title / meta.description
│  └─ en.json
├─ lib/
│  ├─ core.js            # 纯逻辑，零 Cordis / 零 FS；可 node --test
│  ├─ index.js           # 宿主插件（RPC + agent HTTP + 采集 + 持久化）
│  └─ client.js          # 浏览器 bundle（main 面板 + sidebar 图标 + 样式）
├─ test/
│  ├─ core.test.js       # 19 个单元测试
│  └─ host.test.js       # 3 个宿主集成测试（含真实 HTTP 往返）
├─ README.md             # 安装/配置/排障
└─ DESIGN.md             # 本文档
```

边界原则：

- `core.js` 不依赖 DSH，任何规则可单测、可复用；输入一律视为不可信。
- `index.js` 只做编排：路由注册、RPC 校验、文件持久化、定时器生命周期；所有 Cordis 资源都在 `ctx.effect` 内注册并在 cleanup 释放。
- `client.js` 不引入 DSH 客户端包，只用浏览器模块表的 `react` 与主题 token，避免版本耦合；字体、颜色、边框全部走 `--dsw-alias-*`，自动适配明暗主题。

---

## 4. 接口与数据模型

### 4.1 面板 ↔ 宿主：Connection RPC

- 通道：`/node-monitor-rpc`（绝对路径，由 `ctx.connection.rpc.handle` 注册，走 DSH 已有认证）。
- 调用：`ctx.connection.rpc.call('/node-monitor-rpc', '<endpoint>', payload)`；宿主返回 `{ok:true,value}` 或 `{ok:false,error:{code,message,details}}`。
- 权限：读 `state` 允许已认证主体；其余端点要求 `peer.principal.kind === 'owner'`。
- 所有响应必须 JSON 安全（`jsonSafe` 清洗）；任何异常都映射为 `node-monitor/<code>`，绝不返回堆栈。

| endpoint | 请求 | 返回 `value` | owner |
| --- | --- | --- | --- |
| `state` | `{}` | `State` | 否 |
| `refresh` | `{}` | `State`（先探测全部启用节点） | 否 |
| `addNode` | `NodeInput` | `State` | 是 |
| `updateNode` | `NodeInput & {id, clearToken?}` | `State` | 是 |
| `removeNode` | `{id}` | `State` | 是 |
| `ackAlert` | `{key}` | `State` | 是 |
| `ackAll` | `{}` | `State` | 是 |
| `settings` | `Partial<Settings>` | `State` | 是 |
| `testNode` | `{id} \| NodeInput` | `{success, latencyMs, error, snapshot, checkedAt}` | 是 |

错误码（`code` 去掉 `node-monitor/` 前缀后）：`forbidden`、`invalid-input`、`invalid-name`、`invalid-url`、`invalid-adapter`、`invalid-path`、`not-found`、`limit-reached`、`unknown-endpoint`、`internal`。

### 4.2 节点代理 HTTP API

| 路径 | 认证 | 说明 |
| --- | --- | --- |
| `GET /node-monitor/api/v1/health` | 无 | `{ok:true, protocol, name}`；极简探活，不含任何数据 |
| `GET /node-monitor/api/v1/status` | `Authorization: Bearer <agentToken>` | 只读聚合快照；`401` 带 `www-authenticate`，`429` 限流 |

限流：正常请求 240 次/分钟/IP；认证失败 20 次/分钟/IP（防止令牌爆破）。响应头 `cache-control: no-store`，`x-content-type-options: nosniff`；响应体上限 512KiB。

`status` 响应结构：

```json
{
  "protocol": "dsh.node-monitor/1",
  "generatedAt": "2026-11-12T01:00:00.000Z",
  "host": { "hostname": "box", "platform": "linux", "arch": "x64", "version": "0.1.0", "uptimeSec": 12345 },
  "sessions": { "total": 3, "running": 1, "idle": 2 },
  "metrics": {
    "cpuPct": 21.4, "memPct": 43.2, "memUsedBytes": 100, "memTotalBytes": 200,
    "diskFreePct": 71.5, "diskFreeBytes": 1000, "diskTotalBytes": 2000, "load1": 0.4
  },
  "alerts": [{ "code": "deploy.pending", "severity": "warning", "params": { "job": "api" } }],
  "recent": [{ "at": "2026-11-12T00:59:00.000Z", "code": "event.agentRunning", "params": { "agent": "abc12345" } }]
}
```

### 4.3 通用适配器（generic）

不要求对端是 DSH，只需要返回最小健康契约（字段均可选）：

```json
{ "ok": true, "status": "ok|degraded", "metrics": { "cpuPct": 10, "memPct": 20, "diskFreePct": 50 },
  "sessions": { "total": 1, "running": 0 }, "alerts": [ { "code": "...", "severity": "warning" } ] }
```

`ok:false` / `status:'error'|'down'` 会被归类为 `remote-unhealthy`；响应仍是 DSH 面板统一渲染。因此「同一协议」不是前提，**协议差异被适配器吸收**。

### 4.4 数据模型

```ts
Node        { id, name, baseUrl, adapter:'dsh'|'generic', path, tags[], enabled,
              createdAt, updatedAt, hasToken? }              // 永不含令牌
NodeInput   { name, baseUrl, adapter, path?, tags?, enabled?, token? }  // token 只写不读
Probe       { status:'ok'|'error', checkedAt, latencyMs, failures,
              error:{code,message}|null, snapshot:Snapshot|null,
              protocolMismatch?, lastSeenAt? }
Snapshot    { protocol, generatedAt, host, sessions, metrics, alerts[], recent[] }
Alert       { key, nodeId, code, severity:'critical'|'warning'|'info', params, since, acked? }
Event       { at, code, kind, params, level }
State       { protocol, generatedAt, startedAt, settings, token:{agentEndpointEnabled, source},
              server:{hostname,platform,arch,uptimeSec,origin},
              nodes[], probes:{ [nodeId]: Probe }, alerts[], events[], summary }
Settings    { refreshMs, timeoutMs, offlineAfterFailures, latencyWarnMs,
              cpuWarnPct, memWarnPct, diskWarnFreePct, eventsLimit }
PersistedV1 { version:1, updatedAt, seededSelf, nodes[], settings, acks }
Secrets     { agentToken, nodeTokens:{ [nodeId]: string } }    // 0600，不出宿主
```

磁盘布局（默认 `~/.dsh/node-monitor/`，目录 0700）：

- `state.json`：节点配置、设置、acks（原子写 + 0600，不含令牌）
- `secrets.json`：agentToken 与逐节点令牌（0600，原子写，日志/响应永不包含）

---

## 5. 多端 UI/UX 与左侧栏入口

### 5.1 左侧栏入口

- 注册：`ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name:'sidebar.panellist', id:'node-monitor', order:20, locale:'node-monitor', label:()=>t('panel') }, MonitorIcon))`。
- 图标：24×24 线性 SVG，右上角状态点直接画在 SVG 内部：
  - 绿：至少一个在线且无告警/异常/离线
  - 黄：有告警或有 degraded 节点
  - 红：有 critical 告警或离线节点
  - 灰：还没有数据（首次加载 / 宿主未就绪）
- 与 `main` 面板用同一个 id `node-monitor`：DSH 侧栏点击自动 `layout.selectPanel(id)`，无需自己处理路由。
- 权限：图标对已认证用户可见；写操作在面板内校验 owner，非 owner 只读（按钮返回 `node-monitor/forbidden`）。
- 降级：宿主 RPC 失败时图标保持灰点，面板顶部出现错误 banner + 「重试」，不阻塞整个 DSH 侧栏（slot 注册失败也只影响本插件）。

### 5.2 总览

- 汇总 chips：节点总数、在线、异常、离线、未确认告警。
- 告警区：按严重度着色的告警行，显示节点名、原因、当前值、持续时长、确认按钮、全部确认。
- 节点卡片：状态点 + 名称 + 地址 + 适配器 + 延迟 + 最近在线；CPU/内存/磁盘可用三条指标；底部会话数与告警数；离线/不稳定时卡片边框变色；点击进详情，`⋯` 直接编辑。
- 最近活动：宿主的节点状态跃迁与 agent 生命周期事件（新建/运行/空闲/释放）。
- 空态：说明自检节点与接入步骤，提供「接入节点」。

### 5.3 详情

- 顶部：返回、状态 pill、名称/地址、立即探测、编辑、移除。
- 指标区：CPU、内存、磁盘可用、运行中会话占比。
- 信息区：地址、适配器、主机名、平台/架构、运行时长、延迟、最近探测、最近在线、会话、负载、内存/磁盘用量、令牌状态、协议版本、最近错误。
- 该节点的告警与远端最近活动。
- 移除使用二次确认弹窗。

### 5.4 响应式与移动端

- 断点 `760px`：单列卡片、头部纵向堆叠、详情操作按钮铺满、信息行改为上下排布、弹窗从底部弹出（sheet 风格）、点击区域 ≥ 32px。
- 手机浏览器：无需安装 App；`document.hidden` 时暂停轮询，回到前台立即刷新，节省移动网络与电量。
- 交互：卡片支持键盘 Enter/Space 打开；弹窗 `role=dialog` + `aria-modal`；图标有 `aria-label`；颜色不作为唯一信息载体（同时有文字状态）。

### 5.5 状态与降级语义

| 场景 | 表现 |
| --- | --- |
| 首次加载 | 骨架 loading（仅无数据时），侧栏图标灰 |
| 单节点离线 | 卡片红边框、告警、详情显示最近错误；其它节点不受影响 |
| 协议不一致 | 仍显示可用数据，黄色告警 `node.protocol`，提示升级对端 |
| RPC 失败 | 顶部 banner + 重试；保留上次数据（stale-while-error），轮询指数退避 |
| 页面隐藏 | 暂停 5s 轮询，改为 2.5s 轻量检查可见性 |
| 宿主重启 | 面板下一次轮询自动恢复；状态从 `state.json` 恢复 |
| 令牌轮换 | 旧探测变 `auth` 告警；编辑节点粘贴新令牌后恢复 |

---

## 6. 安全

1. **认证与授权**
   - 面板 → 宿主：DSH Connection RPC，自带会话认证；写端点强制 owner。
   - 宿主 → 节点：`Authorization: Bearer <per-node token>`，`timingSafeEqual` 摘要比较；空令牌直接拒绝。
   - agent 端点默认开启（本机生成令牌）；可用 `DSH_NODE_MONITOR_TOKEN` 统一注入，便于容器编排与密钥管理。
2. **令牌生命周期**
   - 首次启动生成 24 字节随机（48 hex），写 `secrets.json` 0600（目录 0700），原子 tmp+rename。
   - State、RPC 响应、日志、错误信息都不含令牌；测试断言 `JSON.stringify(state)` 不包含令牌。
   - 轮换：改环境变量/密钥文件后，在节点编辑中更新令牌；旧 ack/告警随探测结果自动收敛。
3. **输入与传输**
   - `baseUrl` 仅 http/https，禁止内嵌账号密码、查询串、hash；探测 `redirect:'error'` 阻断 SSRF 重定向；超时与响应大小上限。
   - 远端快照白名单清洗（`sanitizeSnapshot`），告警参数 `jsonSafe`，React 文本渲染天然转义，避免远端内容注入。
   - agent 端点独立限流与认证失败限流，401 不回显令牌是否存在。
4. **最小暴露**
   - agent 端点只返回聚合只读数据：主机名、平台、负载、会话计数、事件摘要；不返回会话内容、提示词、工作区路径、文件、工具输出。
   - `/health` 无认证但无数据，便于 LB/探活。
5. **审计与可观测**
   - 节点增删改、告警确认写事件（面板「最近活动」）；宿主日志统一 `[node-monitor]` 前缀。
   - 不记录请求头、令牌、响应体原文。

### 6.1 加载安全（v0.1.1 加固）

插件加载发生在宿主进程的关键路径上：安装、升级、profile 热重载都会重新激活插件。v0.1.1 之前 `apply()` 会等待 `connection`/`webServer` 就绪（最长 8 秒），重载窗口内这段等待会被视为插件激活卡死，对外表现为整站无响应/502，用户侧观感就是「装完插件软件崩了」。现在的约束是：**插件加载绝不阻塞宿主，也绝不向 Loader 抛错**。

| 风险点 | 加固后的行为 |
| --- | --- |
| 服务未就绪 | `apply()` 立即返回 disposer；`start()` 在后台执行，Web 集成只等 1.5s，之后后台补挂 |
| 状态文件读写失败 | 捕获后降级为空状态，仍在内存中生成令牌并提供端点，下一次保存重试 |
| 热重载期通道/路由重名 | RPC 通道 5 次×400ms 重试；路由注册单独 try/catch，失败只告警 |
| 面板渲染异常 | 浏览器侧 `PanelBoundary` 隔离，只在本面板显示提示与刷新按钮 |
| 需要紧急停用 | 配置 `enabled: false` 或环境变量 `DSH_NODE_MONITOR_DISABLE=1`，`apply()` 直接返回 |

加载期不做业务写盘、不发起网络请求、不注册全局监听；采集器首个 tick 延迟 600ms，避免与宿主启动争抢。回归用例 `apply 立即返回 disposer 且禁用开关不注册任何东西`、`宿主服务缺失或 inject 抛错时启动不抛异常` 固定了这些约束。

---

## 7. 部署与运维

### 7.1 安装/升级/回滚

- 安装：`dsh plugin add <本目录>`（或插件管理安装本地 bundle）。插件行写入 profile patch，HMR 生效，无需重启。
- 升级：覆盖目录后重新 `dsh plugin add`；条目 id 不变，状态与密钥保留。
- 回滚：`dsh plugin remove dsh-node-monitor`（或禁用条目），插件卸载时通过 `ctx.effect` cleanup 释放 RPC/路由/定时器；`state.json`/`secrets.json` 保留以便重装恢复。
- 多节点滚动：先升级一个节点验证，再批量；协议字段保证旧节点仍可被新宿主读取（仅告警提示版本）。

### 7.2 反向代理与网络

- 反代需转发 `/` 与 `/node-monitor/*`（同一 upstream、同一端口）；示例：`location / { proxy_pass http://127.0.0.1:3081; }` 即可覆盖。
- HTTPS 必须由反代或 DSH TLS 配置提供；插件自身不终止 TLS。
- 节点间放行出站到各节点 443/3081；宿主不需要入站（除非作为被监控节点）。
- 跨公网建议只暴露 `/node-monitor/api/v1/health`，`/status` 用防火墙/反代白名单限制来源 IP。

### 7.3 运维手册

| 操作 | 方法 |
| --- | --- |
| 健康检查 | `curl https://node/node-monitor/api/v1/health` |
| 手工验证令牌 | `curl -H "Authorization: Bearer $TOKEN" https://node/node-monitor/api/v1/status` |
| 备份 | 备份 `~/.dsh/node-monitor/state.json`（不含令牌，可安全拷贝） |
| 迁移 | 新机安装插件 → 复制 `state.json` → 重新为每个节点填令牌 |
| 可观测 | 宿主日志关键字 `[node-monitor]`；面板告警与事件；`state` 返回 `server.uptimeSec` |
| 容量 | 节点上限 64；每节点每周期 1 次 GET；快照 ≤ 512KiB；状态文件很小 |
| 时钟 | 依赖 ISO 时间戳；节点间时钟偏差会影响「最近在线」显示，建议 NTP |

---

## 8. 实施计划与验收

### 8.1 里程碑（已全部完成）

| 阶段 | 内容 | 产出 |
| --- | --- | --- |
| M1 设计与契约 | 需求、假设、架构、RPC/agent 契约、数据模型 | 本文档 + core.js 常量 |
| M2 纯逻辑 | 校验、探测、适配器、状态归并、告警、清洗、持久化 | core.js + 19 个单测 |
| M3 宿主 | RPC、agent HTTP、采集器、事件、持久化、限流 | index.js |
| M4 客户端 | 侧栏入口、图标状态、总览/详情/弹窗、响应式、轮询与降级 | client.js |
| M5 集成 | 安装、HMR、真实 HTTP 往返、GUI 验证 | 3 个宿主集成测试 + 浏览器截图 |
| M6 文档与交付 | README、DESIGN、locale/icon | 本包 |

### 8.2 测试方案

- 单元（`test/core.test.js`，23 例）：URL 归一化与拒绝、节点输入校验、令牌生成/恒时比较、设置夹取、指标推导、快照白名单、协议适配、探测错误码、状态机、告警推导与 `since`、汇总、事件环、持久化往返与令牌剥离、`jsonSafe`。
- 集成（`test/host.test.js`，9 例）：
  1. 自检节点、owner 权限、增删改、测试连接、设置、ack、重启恢复、文件 0600 且不含令牌；
  2. agent 端点：401/200/HEAD/405/health、快照契约、响应不含令牌；
  3. 真实 HTTP 往返：起本地假节点 → 探测在线 → 远端告警 + 确认 → 错误令牌归类 `auth`；
  4. Hub 登录材料：只写 `secrets.json`，`state.json` 与 RPC 响应无明文，掩码只含 host；
  5. 一次性票据：`openTicket` → `/node-monitor/open` 302 到登录地址；重放 / 篡改 / 缺票 → 403，非 GET → 405；
  6. 清除登录材料后打开回落到节点 baseUrl；非 owner 调 `setLogin` / `openTicket` → `forbidden`；
  7. 控制面默认关闭 → 403 `control-disabled`；
  8. 开启后 `plugins.list` 返回可管理列表，dry-run 不调用，真实启停需 `confirm:true`，`restart` 未允许/未确认都被拒绝；
  9. 审计写入 `audit.jsonl`（0600）且不含令牌。
- 端到端（GUI）：见 §8.5；v0.2.0 验证「配对 → 打开 → 进入远端真实 DSH 界面」，v0.3.0 另验证会话概览（无正文泄漏）、控制面板（列表/行内确认/dry-run）、同源内嵌 iframe、筛选与告警深链、移动端。

```bash
cd /root/dsh_workspace/dsh-node-monitor && npm test
```

### 8.3 验收标准（逐条对照原始需求）

- [x] 可连接**多个** DSH 节点：注册表 + 并发探测 + 单节点失败不影响其它节点
- [x] Windows PC / 云服务器：Node 侧跨平台，地址无平台假设
- [x] 手机 / PC / 浏览器：DSH Web 原生面板，760px 响应式，手机可当监控台
- [x] **左侧栏入口固定**：`sidebar.panellist` order 20，与 `main` 同 id，图标内状态点
- [x] 状态总览 / 节点详情 / 任务进度 / 日志 / 告警 / 基础管理全部实现
- [x] 不假设单一协议：`dsh` 与 `generic` 适配器，未知适配器拒绝并可扩展
- [x] 不在客户端或日志暴露密钥：token 只存宿主 0600，响应/日志/测试断言均校验
- [x] 非静态页：宿主周期探测 + 面板轮询 + 可见性暂停 + 指数退避 + 错误 banner
- [x] 左侧栏权限/徽标/移动端/异常降级：owner 写权限、四色状态点、断点布局、slot 失败隔离
- [x] 测试与文档：27 个自动化测试 + README + 本设计文档
- [x] 多机 Hub（v0.2.0）：登录材料配对、一次性票据、一键打开远端真实 DSH 界面、旧宿主降级

### 8.4 后续演进

1. **推送式实时**：agent 端点增加 SSE，宿主订阅后把变更推给面板，替代 5s 轮询。
2. **更细的任务进度**：接入 DSH 的 agent/subagent 事件，按会话展示当前步骤、待办与工具调用统计。
3. **历史与趋势**：把 `state.json` 换成 SQLite/时序存储，面板加 CPU/内存/延迟折线。
4. **RBAC 与多租户**：节点分组、按用户授权只读/可写、操作审计导出。
5. **通知通道**：告警转发 Webhook/Telegram/邮件，支持静默窗口与升级策略。
6. **远程操作**：在受控前提下提供重启会话/终止任务等能力（需再设计二次确认与审计）。
7. **拓扑与依赖**：多宿主互监（A 监控 B、B 监控 A）时避免环路与重复告警（可选 leader 探测）。

### 8.5 实机验证记录（2026-11-12）

验证在容器内的真实 DSH 上进行：主实例 `http://127.0.0.1:3081`（正式 profile）与隔离实例 `http://127.0.0.1:3099`（`DSH_HOME=/tmp/dsh-verify`，复制 profile 配置并用符号链接复用 `node_modules`，避免影响正式会话与存储）。面板通过 `dsh-client-connection` 的 Cookie 鉴权访问；GUI 自动化用 Playwright（chromium）执行。

| 验证项 | 方法与证据 | 结果 |
| --- | --- | --- |
| 单元/集成测试 | `npm test` | 24/24 通过 |
| bundle 安装 | `plugin_manager install_bundle`（target=本包目录） | `applied`；profile 依赖为 `link:/root/dsh_workspace/dsh-node-monitor`，`dsh.profile.bundles` 含本包 |
| agent 端点 | `curl /node-monitor/api/v1/health`、无令牌访问 `/status` | health 200；status 401（带 `WWW-Authenticate`） |
| 密钥文件 | `ls -l ~/.dsh/node-monitor/`，检查 `state.json` | `0600`；状态文件不含 token 字段 |
| 侧栏入口 | 点击 `sidebar.panellist` 行「节点监控」 | 选中 `main` 面板；图标按汇总着色（在线绿/告警红） |
| 总览刷新 | 观察 5s 轮询下的指标与「最近活动」 | 数值与事件随时更新；页面隐藏后轮询暂停 |
| 添加节点 | 弹窗填名称/地址/适配器/令牌 → 测试连接 → 保存 | 成功；测试连接可返回失败原因（离线地址 → `unreachable`） |
| 告警闭环 | 离线节点约 10s 后产生 `节点离线`；点「确认」；再移除节点 | 告警出现并计入摘要；确认后未确认数归零；移除后统计恢复 |
| 详情视图 | 打开节点详情，核对信息网格与节点级活动 | 指标、主机、延迟、令牌状态、协议、告警、事件均正确 |
| 跨实例多节点 | 第二实例 3098（独立 `DSH_HOME`、独立 agent 令牌）以 DSH 适配器接入 3099 的面板 | `节点 2 / 在线 2`；两节点独立上报指标；详情页显示远端主机名/负载/内存/磁盘；0 console error |
| 移动端 | 视口 390×844 | 单列布局、卡片与弹窗自适应 |
| 控制台 | 全流程监听 `console.error` / `pageerror` | 0 条（`docs/console-errors.json`） |
| 加载安全（v0.1.1） | 隔离实例 3096 冷启动 + 面板打开 + 在插件管理里卸载本插件 | 冷启动 health 200；面板正常；卸载时宿主进程存活、无 fatal/unhandled，说明加载/卸载都不再拖住宿主 |
| Hub 配对（v0.2.0） | Hub 实例 :3093 + 节点实例 :3092（各自独立 `DSH_HOME`）；在编辑弹窗粘贴节点 `?token=` 地址并保存 | 面板显示「已配对 · 127.0.0.1:3092」；`state.json` 无明文、`secrets.json` 0600 含明文；节点由 401 变在线 |
| 一键打开（v0.2.0） | 点卡片「打开」→ 捕获新标签页 | URL 经 `/node-monitor/open` 302 到节点登录地址；新标签页标题 `DeepSeek Harness`，侧栏含该节点自己的「节点监控」，即真实远端 DSH；Hub 控制台 0 error |
| 票据安全（v0.2.0） | 集成测试：重放、篡改签名、缺票、POST | 403 / 403 / 403 / 405；非 owner 调用 → `forbidden` |
| 旧宿主降级（v0.2.0） | 主实例 :3081（宿主半仍为 v0.1.x）刷新新客户端后点「打开」「编辑」 | 卡片显示 `内网 / 未配对`；「打开」直接打开 `node.baseUrl`；编辑弹窗显示 `login.needRestart` 提示；控制台 0 error |

截图（`docs/screenshots/`）：`sidebar.png`、`overview.png`、`multi-node.png`、`node-detail.png`、`remote-detail.png`、`add-node.png`、`add-node-test.png`、`settings.png`、`mobile.png`、`alert-acked.png`；v0.2.0 Hub：`hub-overview.png`、`hub-pairing.png`、`hub-open-node.png`、`hub-mobile.png`。

已知宿主侧现象：`plugin_manager` 安装触发 profile 重建时，主实例日志出现 `listen EADDRINUSE: address already in use 127.0.0.1:3081` 与 `HMR is disposed`。这是宿主端口占用导致热更新释放失败，不是插件逻辑错误；插件入口仍已生效（health 探针可证）。生产环境安装后如遇此日志，重启一次 `dsh web` 即可。

## 9. 多机集中管控 Hub（v0.3.0 / H0–H4）

### 9.1 目标与边界

用户要求（2026-11-12 确认）：「很多台设备，可能不在同一个网络；要求能够和正常的 DSH 一样正常发消息、正常进行任务；只到 DSH 层；单人使用；控制端可以是 PC / 平板 / 手机 / 浏览器」。

结论：**不重写聊天 UI，也不代理聊天协议**。Hub 只做两件事：

1. **看清**每台节点的状态（既有能力）；
2. **一键进入**每台节点自己的真实 DSH 界面（本版新增），会话与任务始终由节点自己的 DSH 处理。

这保证「和正常 DSH 一样」是字面成立的：打开的页面就是节点上正在运行的那套 DSH。

### 9.2 数据模型增量

| 字段 | 位置 | 说明 |
| --- | --- | --- |
| `network` | 节点（`state.json` + RPC） | `lan` / `tailscale` / `tunnel` / `public`，仅用于展示与筛选 |
| `notes` | 节点（`state.json` + RPC） | 备注，≤120 字 |
| `login` | RPC 响应的节点视图 | 掩码 `{configured, host, hasToken}`；**不含 URL / token** |
| `nodeLogins[nodeId]` | `secrets.json`（0600） | 登录材料明文，只在宿主侧 |
| `openSecret` | `secrets.json`（0600） | 票据 HMAC 密钥（32 字节随机，首次生成） |

### 9.3 新增 RPC

| 端点 | 入参 | 返回 | 权限 |
| --- | --- | --- | --- |
| `setLogin` | `{id, url}` | 完整 state | owner |
| `clearLogin` | `{id}` | 完整 state | owner |
| `openTicket` | `{id}` | `{nodeId, url:'/node-monitor/open?id=…&t=…', expiresAt, hasLogin}` | owner |

`parseLoginUrl` 只接受 http/https、必须有 hostname、长度 ≤1500；`token` / `access_token` 查询参数用于判断 `hasToken`。非法地址返回 `node-monitor/login-url-invalid`。

### 9.4 一次性票据与打开流程

```
浏览器                   Hub 宿主                    节点 DSH
  │  openTicket(id) ───────▶│
  │◀── {url, expiresAt} ────│  payload=base64url({id,exp,nonce})
  │                         │  sig=HMAC-SHA256(openSecret,payload)
  │  GET /node-monitor/open?id&t ─▶│
  │                         │  校验签名（timingSafeEqual）
  │                         │  校验 exp、id、nonce（一次性）
  │◀──── 302 Location: 登录地址（含 token） ────│
  │  GET 登录地址 ─────────────────────────────────────▶│
  │◀──────────── 真实 DSH 页面（同节点自身会话/任务） ──│
```

- 票据 60 秒过期，`nonce` 用后即删（`openNonces`，上限 200 个）；
- 重放、签名不符、id 不符、票据缺失一律 `403`；非 GET/HEAD `405`；
- 302 响应带 `Cache-Control: no-store` 与 `Referrer-Policy: no-referrer`；
- 未配对登录材料时，302 落到节点 `baseUrl`（用户可手动粘贴令牌）；
- **旧宿主兼容**：若宿主半还是 v0.1.x（无 `openTicket`），面板捕获错误后直接 `window.open(node.baseUrl)` 并提示重启 DSH。

### 9.5 安全取舍

- 登录 token 会出现在**新标签页的地址栏**（因为跳转目标就是 DSH 的登录 URL）。这与手动打开 DSH 的行为一致；风险在浏览器历史/截图，故 UI 只提示「请勿转发该 URL」，不提供复制按钮；
- 宿主**不回显**登录材料：面板只能看到 host 与是否配对；`state.json` 永不含明文；
- 票据可被同一浏览器会话之外的人重放吗？不能：nonce 一次性 + 60s + 绑定节点 id；但若攻击者已能读取 Hub 与浏览器的通信（owner 会话），等同 owner，属于单用户模型的既有边界；
- 若后续做多用户/RBAC，`openTicket` 必须先落到「用户 → 可访问节点」的授权表（§8.4 第 4 条）。

### 9.6 阶段计划（H0 已完成）

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| H0 | 节点注册扩展（网络/备注）、登录材料配对、一次性票据、一键打开、响应式 | ✅ v0.2.0 |
| H1 | 只读会话概览（节点侧新增只读接口，不改聊天协议） | ✅ v0.3.0 |
| H2 | 同源 iframe 内嵌（不同站明确降级为新标签页） | ✅ v0.3.0 |
| H3 | DSH 层运维控制（插件启停、重启；dry-run + 审计 + confirm 门禁） | ✅ v0.3.0 |
| H4 | 分组筛选、标签、告警联动、批量探测/启停 | ✅ v0.3.1 |

### 9.7 待确认

1. 私有网选型：Tailscale 托管（简单）还是自建 Headscale/WireGuard（可控）？
2. Hub 常驻位置：放在其中一台 DSH、还是单独的轻量机器？
3. 节点登录材料能否统一改由「节点侧插件」生成短期票据（避免长期 token 落 Hub）？——H1 可做。
4. 反向代理是否要纳入交付（通配符 DNS + 证书由谁提供）？

### 9.8 H1–H4 实现说明（v0.3.1）

**H1 会话概览（只读）**

- 节点侧在 `sessionStats()` 里从 `ctx.get('agents').list()` 构造 `{total, running, idle, list}`；`list` 项仅 `{id, model, cwd, createdAt, lastAt, parentId, depth, seeded}`，按 `lastAt` 降序、最多 20 条；`session/event` 只用于更新 `lastAt` 时间戳。
- 不读取、不缓存、不传输任何会话正文；`sanitizeSessionList` 再次做白名单，Hub 侧只渲染 ID 短名（去 `session-` 前缀）、状态点、模型、cwd basename、相对时间、`子会话` 标记。
- 这是「看有没有在干活」而不是「看聊了什么」，因此不触碰 DSH 的会话存储与聊天协议。

**H2 同源内嵌**

- 前提：`new URL(node.baseUrl).hostname === window.location.hostname`（DSH 的 Cookie 与启动令牌按 authority 绑定，跨站 iframe 必然 401）。
- 流程：Hub 申请一次性票据 → iframe `src=/node-monitor/open?id&t` → 302 到节点登录地址 → iframe 内加载节点自己的 DSH。
- iframe 属性：`sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"`；`referrerpolicy="no-referrer"`；头部提供「新标签打开 / 关闭内嵌」。
- 跨站时明确降级：提示改用新标签页，不尝试绕过安全边界。节点重启后启动令牌轮换，旧登录材料 401，需重新配对（面板会显示探测告警，便于发现）。

**H3 运维控制（默认关闭）**

- 节点侧 `CONTROL_PATH=/node-monitor/api/v1/control`（POST，Bearer 与状态接口同一令牌），默认 `allowControl:false`；开启方式：插件 `config.allowControl: true` 或 `DSH_NODE_MONITOR_ALLOW_CONTROL=1`，重启 DSH 生效。
- 动作与门禁：`plugins.list` / `bundles.list` 只读；`plugins.setEnabled` 默认 `dryRun:true`（只返回计划），真实执行需 `dryRun:false` 且 `confirm:true`；`restart` 还需 `allowRestart`（`DSH_NODE_MONITOR_ALLOW_RESTART=1`）与 `confirm:true`，返回 202 后 `process.exit(0)`，由 systemd/NSSM/容器拉起。
- 审计：每次调用（含 dry-run 与被拒绝请求）写 `<DSH_HOME>/node-monitor/audit.jsonl`（0600，JSONL，`{ts, action, dryRun, confirm, params, ok, error?}`），**不写令牌**。
- 限流与边界：沿用节点端点限流（按 IP）；body 上限 64KiB；服务端不提供 shell、不提供任意命令、不写节点配置文件（配置编辑留给后续阶段）；控制端点必须位于私有网/反代之后、单用户边界内。
- Hub 侧只做转发（`control` RPC → 节点 POST），不缓存插件列表；页面行内两步确认，重启按钮二次确认。

**H4 分组与告警联动**

- 分组即节点 `tags`；总览筛选条支持关键词（名称/地址）、状态、分组三条件，显示「筛选结果 / 总数」，移动端换行。
- 卡片显示最多 2 个标签；未确认告警行提供「打开节点」直达详情。
- 批量操作（v0.3.1）：Hub RPC `batchNodes {op, ids}`（owner-only），`op ∈ enable/disable/probe`，ids 去重、单次 ≤64；`probe` 并发探测所选节点并重算告警，`enable/disable` 直接改节点「是否纳入监控」并落盘（停用节点不再周期探测、不产生新告警），三者都会写事件流；客户端勾选卡片 → 批量栏（全选当前沿用筛选结果）→ 操作完成后清空选择。
## 10. 局域网自动发现（v0.4.0）

### 10.1 目标与边界

- 目标：同一广播域内免手输地址接入；通过「令牌」确认机器归属，而不是靠名字猜测。
- 边界：只做“发现 + 提示”，不做自动接入；广播不含任何秘密；跨网段/跨 NAT 不依赖此机制。

### 10.2 协议

| 项 | 值 |
|---|---|
| 传输 | UDP，端口 `45871`（可 `discoveryPort` / `DSH_NODE_MONITOR_DISCOVERY_PORT` 覆盖） |
| 目标 | 组播 `239.255.43.21` + 受限广播 `255.255.255.255` + `127.0.0.1`（本机联调） |
| 报文 | JSON：`{m:'dsh-node-monitor/discovery/1', v:1, id, label, port, host, version, path, ts}` |
| 频率 | 启动时一次 + 每 30s 一次；接收方 TTL 5 分钟，自动过期 |
| 单播补充 | `DSH_NODE_MONITOR_DISCOVERY_PEERS=host:port,...`，用于本机多实例/特殊网络验证 |

接收方校验：协议/节点 id/来源地址（必须是 RFC1918、链路本地或回环）/时间戳；地址一律取自 UDP 来源（`rinfo.address`），不信任报文自述；自身 id 直接忽略；按 id 去重、最多 32 条。

### 10.3 数据流

1. 节点 A 启动 → `startDiscovery()` 绑定 UDP → `announceDiscovery()` 广播身份；
2. 节点 B 收到 → `parseAnnouncement()` 校验 → `mergeDiscovery()` 存入内存（不落盘）；
3. B 面板轮询 `state` 时读到 `discovery.nodes`（含 `address/label/shortId/version/lastSeen/added`）；
4. 用户点「接入」→ 前端用发现到的地址预填「添加节点」→ 粘贴 A 的令牌 → `addNode` → 后续走既有 Bearer HTTP 探测。

### 10.4 RPC 增量

| 端点 | 语义 |
|---|---|
| `discoveryProbe` | 立即广播一次并返回最新 state |
| `selfToken` | 返回本机节点 ID/名称/令牌（owner-only，仅显式调用时返回，默认界面掩码） |
| `rotateToken` | 重新生成 12 位易读令牌（需 `confirm:true`），写回 `secrets.json` 0600 |
| `updateLabel` | 修改显示名称（≤40 字符），立即广播新名字 |

### 10.5 安全取舍

- 广播即“公开喊话”，同网段任何人都能看到节点名与地址——这是有意的可见性；令牌才是准入凭证。
- 令牌默认掩码，显示需 owner 点击；渲染层不写日志；`state` 与发现报文都不含令牌。
- 旋转令牌会立即让旧接入方 401，适合“离职/换机/怀疑泄露”场景。
- 公司多人场景：每个人用自己的显示名 + 自己的令牌；Hub 只是观察台，令牌由各人自己保管。

### 10.6 已知限制

- 广播被部分企业 WiFi / 访客网络 / AP 隔离拦截时发现列表为空，可退回手动添加或用 `DISCOVERY_PEERS` 单播；
- 双实例同机验证需给每个实例不同的 `discoveryPort`，否则 UDP 端口复用后只有部分报文可达；
- 跨网段不会自动发现，仍需 Tailscale / frp / Cloudflare Tunnel 等组网。


### 10.7 全自动组网（v0.5.0）

目标：用户只装插件，不再做任何配置。

- **自监听**：宿主额外 `http.createServer` 监听 `0.0.0.0:45873`（`DSH_NODE_MONITOR_AGENT_PORT` 可改），对外提供 `status/health/pair/control` 四个端点；这样对端无需 DSH `--host`，DSH 原 3081 端口保持只绑回环。
- **互认**：UDP 广播新增 `ap`（agent 端口）；收到广播后宿主自动 `POST http://<ip>:<ap>/node-monitor/api/v1/pair`（请求体带 `auto:true`），对端在 `autoPair` 开启时接受局域网请求并回传自己的令牌，双方自动写节点（`tags: paired,auto`，baseUrl 用 agent 端口）。
- **默认值**：`publicListen=true`、`autoPair=true`、`allowControl` 在自动组网模式下默认开启（仍有 dry-run/confirm/audit，可 `DSH_NODE_MONITOR_ALLOW_CONTROL=0` 关闭）；`allowRestart` 仍默认关闭。
- **安全边界**：只在局域网/回环生效；仅自动组网信任同一广播域；跨网段仍需 Tailscale/frp；自动节点不提供「打开完整 DSH 界面」（那需要 DSH 登录令牌，插件无法自动获取）。
- **测试**：40 项全过；双实例（3093/3092，agentPort 45873/45874）零手工操作下双方 state 各自出现对端 `paired,auto` 节点。

## 11. 远程主节点（v0.6.0，跨网络反连）

### 11.1 目标与拓扑

服务器上的 DSH 作为 Hub；每台 PC 的插件向 Hub **主动出站上报**，Hub 把 PC 投影为节点，实现跨 NAT 的集中查看与控制。

```
PC (NAT 后) ──POST /hub/push（Bearer 加入令牌，每 3s）──▶ 服务器 DSH（Hub）
        ◀── commands 队列（下一次 push 取走）──
        ──POST /hub/result──▶
```

### 11.2 协议

| 端点 | 方法 | 认证 | 语义 |
|---|---|---|---|
| `/node-monitor/api/v1/hub/push` | POST | `Bearer <hubToken>` | 上报 `{nodeId,name,hostname,version,payload}`；返回 `{commands:[…]}` |
| `/node-monitor/api/v1/hub/result` | POST | `Bearer <hubToken>` | 回传 `{nodeId,commandId,ok,value|error}` |

- 心跳 3 秒一次（失败也继续重试）；超过 20 秒未上报视为离线。
- `payload` 复用 agent `/status` 的结构（host/sessions/metrics/control/alerts/recent），Hub 用 `sanitizeSnapshot` 清洗。
- Hub 侧状态里 `hubPeers` 只存内存（重启后由各 PC 的下一次上报自动恢复）。

### 11.3 投影与状态

- 远程节点 id 为 `hub:<nodeId>`，adapter `hub`，tags `['hub']`，baseUrl `hub://<nodeId>`，UI 标签「远程」。
- 探测记录由 `hubPeers.lastSeen` 生成：20 秒内为在线，否则按 `offlineAfterFailures` 判离线并告警。
- `buildState().hub = { enabled, origin, peers, link }`；**令牌不进入 state**，只通过 owner-only 的 `hubInfo` 显式读取。

### 11.4 控制生命周期

1. Hub 面板点「加载插件/启用」→ RPC `control { id: 'hub:<nodeId>', action }`；
2. Host 把指令放入该节点的命令队列，RPC 挂起（20 秒超时）；
3. PC 下一次 push 取走指令，本地 `dispatchControl` 执行（仍受 allowControl/dryRun/confirm 约束），POST `/hub/result`；
4. Hub 收到结果后 resolve RPC，写 `event.control`，UI 更新。

支持 `plugins.list`、`plugins.setEnabled`；`restart` 在远程模式下明确不支持（避免把节点重启后失联）。

### 11.5 安全

- 加入令牌 12 位（`XXXX-XXXX-XXXX`），仅 Hub 面板显式显示，可重新生成（旧令牌立即 401）。
- 上报必须 HTTPS（由用户现有反向代理终止）；Hub 不主动连 PC，不需要入站端口。
- 远程控制沿用本地审计 `audit.jsonl`（0600），记录 action/dryRun/confirm/结果，不含令牌。
- 关闭：`DSH_NODE_MONITOR_HUB=0` 或 `config.hub:false`。

### 11.6 已知限制

- 3 秒级轮询，不是实时 WebSocket；对状态查看足够，对交互式操作有 3–20 秒延迟。
- 不支持打开远端完整 DSH 界面（需要 DSH 自己的登录令牌），也不支持远程重启/SSH 级操作。
- 需要服务器有公网 HTTPS 入口；纯 HTTP 仅限可信内网。

### 11.7 加入链接与二维码（v0.6.1）

- 链接格式：`<origin>/#node-monitor-join=<token>`；`#` 片段不会随 HTTP 请求发送，令牌因此不进入服务器访问日志；页面读取后立即 `history.replaceState` 清除地址栏。
- 生成：`core.encodeJoinLink(origin, token)`；`origin` 取 `config.publicUrl` / `DSH_NODE_MONITOR_PUBLIC_URL`，否则 `webApp.getAdvertisedUrl()`，最后回退 `webServer.getOrigin()`（反代部署请配置前两者之一）。
- 解析：`core.parseJoinLink` 校验 http/https、令牌长度；客户端粘贴链接到地址输入框时自动填入 origin+token，不自动连接（仍需用户点「连接」）。
- 二维码：宿主侧用内置 `qrcode`（MIT，Kazuhiko Arase，随包分发）生成 SVG，`hubJoin` RPC 返回 `{link, svg, origin}`；不调用任何第三方二维码服务。
- 安全：链接本身即凭据，等同加入令牌；泄露后可在 Hub 面板「重新生成」使旧链接立即失效。

### 11.8 测试

- core：`encodeJoinLink`/`parseJoinLink`（含非法协议、缺令牌、路径保留）。
- host：owner 可生成 `hubJoin`（link 含令牌、svg 以 `<svg` 开头、`publicUrl` 生效），非 owner 403。
- 实机：Hub 生成链接→剪贴板内容与面板一致；二维码截图用 `jsQR` 解码回原文；客户端粘贴链接后地址/令牌自动填充并连接成功，0 console error。

## 12. 无服务器接入码（v0.6.2）

### 12.1 目标

没有公网服务器时，让任意一台电脑作为被查看端，另一台粘贴一条链接即可接入；链路复用 agent 端口（`45873`），不依赖 DSH 的 `--host` 与登录态。

### 12.2 地址枚举

宿主遍历 `os.networkInterfaces()`，排除 internal，输出 `{url, family, iface}`：
- IPv4：`http://<ip>:<agentPort>`
- IPv6：`http://[<ip>]:<agentPort>`（去掉 `%scope`）

无任何非回环地址时回退 `http://127.0.0.1:<agentPort>`。对应 Tailscale（100.x）、ZeroTier（10.x/172.x）、局域网、IPv6 都能被枚举到。

### 12.3 接入链接

- 格式：`<dsnOrigin>/#node-monitor-add=<base64url(JSON{v:1,u,t})>`，`u` 为 agent 地址，`t` 为节点令牌。
- 生成：`nodeInvite` RPC（owner-only），可传 `address` 指定候选；同时返回二维码 SVG（复用 `hubJoin` 的本地 QR 生成）。
- 解析：`core.parseNodeLink` 校验 http(s)、版本、令牌长度；客户端在「节点地址」输入框 `onChange` 检测到 `#node-monitor-add=` 时自动填入地址与令牌（仍需点保存）。
- 安全：链接含令牌，等同节点令牌；只经 `#` 片段传递，不进入 HTTP 请求与访问日志。

### 12.4 IPv6 双栈

`startAgentServer()` 使用 `listen({port, host:'::', ipv6Only:false})`；若系统不支持则通过 `error` 分支回退到 `0.0.0.0`。IPv6 直连时 URL 必须带方括号。

### 12.5 测试

- core：`encodeNodeLink`/`parseNodeLink`（IPv4/IPv6、错误片段、版本）。
- host：`nodeInvite` 返回候选地址、链接可解析且令牌匹配、可指定 address；双栈监听由实机 `ss -lntp` 验证为 `*:45873`。
- 实机：A 生成接入链接 → B 粘贴 → 自动填 `http://172.18.0.7:45873` + 令牌 → 保存后节点在线，0 console error。
