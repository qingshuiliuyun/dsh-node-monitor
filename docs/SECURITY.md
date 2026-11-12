# 安全模型

本文说明 `dsh-node-monitor` 的信任边界、令牌权限、数据暴露面与加固建议。实现细节见 [DESIGN.md](../DESIGN.md) 第 9 节。

## 报告安全问题

请通过 GitHub Issue（标题以 `[security]` 开头）或仓库维护者私下渠道反馈，不要在公开 Issue 中粘贴真实令牌、`secrets.json`、内网地址或会话内容。收到后会在下一个补丁版本修复并致谢。

## 资产

| 资产 | 位置 | 泄露后果 |
| --- | --- | --- |
| `agentToken` | 宿主 `~/.dsh/node-monitor/secrets.json`（0600） | 完整读写：状态、会话元数据、插件启停（若 `allowControl`） |
| `statusToken` | 同上 | 只读看板级状态；不能控制 |
| `hubToken` | 同上（Hub 侧生成） | 可向 Hub 上报伪造节点状态；不能读其他节点 |
| 节点登录地址 | 同上 `nodeLogins` | 可打开对应 DSH 的真实界面（等同该 DSH 登录） |
| `openSecret` | 同上 | 可伪造一次性打开票据（60 秒、单次、绑定节点） |
| 会话元数据 | 内存/状态响应 | ID、状态、模型、工作目录、最近活动；**不含正文、工具输出、文件内容** |
| `audit.jsonl` | 宿主 0600 | 操作审计记录（动作、参数、结果），不含令牌 |

插件不读取：会话消息正文、工具调用参数/输出、附件、提示词、模型密钥。`sanitizeSnapshot` 与 `restrictSnapshot` 是唯一的出站白名单，新增字段必须同步更新并补测试。

## 信任边界

```
浏览器（owner） ──Cookie/Connection RPC──► 宿主 ──Bearer HTTP──► 其他节点
                                              │
                                              ├──UDP 发现（无令牌）
                                              └──Hub 反连（hubToken）
```

| 通道 | 认证 | 授权 |
| --- | --- | --- |
| 面板 ↔ 宿主（`/node-monitor-rpc`） | DSH 自身 Web 会话 | `peer.principal.kind === 'owner'`；所有写操作与读取令牌均需 owner |
| 浏览器 → 宿主（`/node-monitor/open`） | 无 Cookie 校验，依赖一次性 HMAC 票据 | 票据绑定节点、60 秒过期、单次使用、nonce 防重放 |
| 节点 → 节点（`/status`、`/pair`、`/control`） | `Authorization: Bearer <agentToken 或 statusToken>` | `agentToken` 完整权限；`statusToken` 只读、无明细、控制关闭 |
| PC → Hub（`/hub/push`、`/hub/result`） | `hubToken` | 只能上报自己的节点状态、取回/回传自己的命令 |
| UDP 发现 | 无 | 只广播公开身份（id、显示名、端口、版本、agent 端口），不广播令牌；接入必须再出示令牌 |

## 令牌权限矩阵

| 能力 | `agentToken` | `statusToken` | `hubToken` |
| --- | --- | --- | --- |
| 读取状态/指标/会话明细 | ✅ | 只读、无明细 | ❌ |
| 读取看板级汇总 | ✅ | ✅ | ❌ |
| `/control` 插件启停 | ✅（需 `allowControl`） | ❌ 401 | ❌ |
| 配对/回登 | ✅ | 只读登记 | ❌ |
| Hub 上报 | ❌ | ❌ | ✅ |
| 轮换令牌 | 面板 owner | — | 面板 owner |

- `agentToken` 与 `statusToken` 相互独立；轮换连接令牌会同时轮换二者，旧令牌立即失效。
- 自动组网与自动配对只交换 `statusToken`；要获得控制能力，必须由操作者在对方面板复制完整令牌并手动粘贴。
- `hubToken` 只保存在 Hub 的 `secrets.json` 与客户端 `hubLink` 中，不进入 `state`、日志或二维码以外的链接。

## 传输与网络

- 插件自身只提供 HTTP。**跨公网部署请放在 HTTPS 反向代理之后**（DSH 自带 TLS 配置或 nginx/Cloudflare Tunnel 均可）。
- 局域网内为明文 HTTP：同广播域的攻击者可嗅探到令牌。建议只在可信网络启用自动组网，或配合 ZeroTier/Tailscale 加密网络。
- 默认端口：`3081`（DSH 网页，可选）、`45873`（agent，双栈）、`45871/UDP`（发现）。防火墙最小放行：只开 `45873/TCP` 即可实现监控与控制；发现需要 `45871/UDP`；「打开/内嵌」需要 `3081` 可达。
- `publicListen` 默认开启（监听 `::`/`0.0.0.0`）。仅本机使用时设 `DSH_NODE_MONITOR_PUBLIC_LISTEN=0`。

## 默认安全配置

| 开关 | 默认 | 说明 |
| --- | --- | --- |
| `allowControl` | 关 | 开启后才能远程启停插件；建议按需短时开启 |
| `allowRestart` | 关 | 重启会让宿主退出，默认禁用 |
| `autoPair` | 开 | 自动互换只读令牌；关闭后只能手动配对 |
| `discovery` | 开 | 关闭后不广播也不接收发现 |
| `hub` | 开 | 作为 Hub 接收上报；不使用可关 |
| `publicUrl` | 空 | 反代场景必须设置为对外地址，否则链接会显示内网 origin |

## 加固清单

1. 升级后「重新生成连接令牌」，让旧版自动配对保存的完整令牌立即失效。
2. 删除并重新添加早期「自动」节点，确保它们只持有只读令牌。
3. 生产环境关闭 `allowControl`，需要时通过配置临时开启并在操作后关闭。
4. 用防火墙限制 `45873` 只对可信网段/VPN 开放；不要把 `45873` 直接暴露到公网。
5. 反向代理启用 HTTPS，并设置 `DSH_NODE_MONITOR_PUBLIC_URL`。
6. 定期备份并检查 `~/.dsh/node-monitor/audit.jsonl`；不要把它同步到公开位置。
7. 接入码/加入链接含令牌，等同密码：只发给自己的设备，泄露后立即轮换令牌。
8. 怀疑泄露时：轮换连接令牌 → 轮换 Hub 令牌 → 检查审计中的 `plugins.setEnabled` 记录。
9. 自动配对有独立限流（每 IP 12 次/分钟、60 次/小时）与 16 个自动节点上限；不需要时设 `DSH_NODE_MONITOR_AUTO_PAIR=0`。
10. 控制命令结果绑定 `nodeId`，其他客户端无法替目标节点回传结果。

## 审计

- 文件：`~/.dsh/node-monitor/audit.jsonl`（0600，>5MB 轮转 `.1`）。
- 字段：`ts`、`action`、`dryRun`、`confirm`、`params`（清洗后）、`ok`、`error?`。
- 覆盖：`plugins.list`、`plugins.setEnabled`、`restart`（含被拒绝的请求）。
- 不含：令牌、登录地址、会话内容。

## 已知限制

- UDP 发现没有加密与签名：同网段可伪造公告，但伪造者拿不到令牌，无法完成配对/接入。
- 接入码链接没有有效期；轮换令牌即失效。
- Hub 的 peer 列表在内存中，重启后由客户端 3 秒内重新上报恢复；离线节点会在 20 秒后标记离线。
- 「打开完整 DSH 界面」依赖 DSH 自身的登录令牌，插件无法也不应自动获取。
- 插件以 DSH 宿主权限运行；只应从可信来源安装，安装前可审阅本仓库源码与构建产物。
- Hub 的加入令牌是**每个 Hub 共享**的：拿到令牌的客户端可以用另一个 `nodeId` 上报伪造状态。当前用「同 nodeId 60 秒内换 IP 拒绝」缓解，但没有按客户端签发独立令牌。建议每个信任域单独一个 Hub，怀疑泄露时轮换 `hubToken`。
- 自动配对不校验对端身份，只交换只读令牌；同网段伪造公告可以让面板出现一条只读假节点（不能控制，也不影响真实节点）。设 `DSH_NODE_MONITOR_AUTO_PAIR=0` 可关闭。

## 版本支持

| 版本 | 状态 |
| --- | --- |
| v0.6.6（当前） | 支持，包含全部安全与健壮性修复 |
| v0.6.5 / v0.6.4 | 支持 |
| v0.6.3 | 支持 |
| ≤ v0.6.2 | 建议升级：自动配对令牌权限过宽、Hub 队列无过期 |
