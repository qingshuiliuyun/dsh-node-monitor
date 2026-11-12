# 安装与部署（v0.6.4）

本文只讲「怎么装、怎么连、怎么排障」。架构与协议见 [../DESIGN.md](../DESIGN.md)，安全模型见 [SECURITY.md](SECURITY.md)。

## 0. 前置条件

- DSH `0.2.2-rc.1` 及以上（Web 或桌面端），profile 为 Web（`web`）。
- 每台机器给 DSH 至少 1 个可用浏览器入口；插件在浏览器里渲染。
- 局域网部署需允许 **TCP 45873**（插件 agent）与 **UDP 45871**（自动发现）。
- 跨公网时不需要开放 DSH 的 3081/网页端口；只需要 45873 或一个隧道/虚拟网。

## 1. 安装

### 方式 A：面板安装（推荐）

1. 打开 DSH →「插件」。
2. 点右上「添加插件」→「安装第三方插件」。
3. 粘贴以下地址之一：

   ```
   https://codeload.github.com/qingshuiliuyun/dsh-node-monitor/tar.gz/refs/tags/v0.6.4
   ```

   或仓库地址：

   ```
   https://github.com/qingshuiliuyun/dsh-node-monitor
   ```

4. 点「安装」，等待完成，**重启 DSH**。
5. 左侧栏出现「节点监控」。

### 方式 B：离线包

1. 解压 `dsh-node-monitor-0.6.4.zip`（顶层目录 `dsh-node-monitor/`）。
2. 「添加插件」里填解压后的**绝对路径**；或命令行：

   ```bash
   dsh plugin add /绝对路径/dsh-node-monitor
   ```

3. 重启 DSH。

### 方式 C：手工挂载（仅调试）

在 profile 的 `package.json` 中：

```json
{
  "dependencies": { "dsh-node-monitor": "link:/绝对路径/dsh-node-monitor" },
  "dsh": { "profile": { "bundles": ["...", "dsh-node-monitor"] } }
}
```

**不要**手改 `cordis.patch.yml`：bundle 自带的 patch 会在加载时合成。改完重启。

## 2. 安装后自检

```bash
# 1) 面板能打开，左侧栏有「节点监控」
# 2) 宿主健康（DSH 端口与 agent 端口都应 200）
curl -s http://127.0.0.1:3081/node-monitor/api/v1/health
curl -s http://127.0.0.1:45873/node-monitor/api/v1/health
# 3) 数据目录与权限（Linux/macOS）
ls -ld ~/.dsh/node-monitor
ls -l  ~/.dsh/node-monitor
# 4) 本机自检节点应显示在线
```

期望：

```json
{"ok":true,"name":"dsh-node-monitor","protocol":"dsh.node-monitor/1","version":"0.6.4"}
```

## 3. 四种部署场景

### 3.1 单机 / 同一局域网（零配置）

1. 两台都安装并重启。
2. Windows 首次启动 DSH 时允许防火墙访问（专用网络即可）。
3. 打开任一台「节点监控」，几秒后「局域网发现」出现对方；点「接入」，粘贴对方「本机配对信息」里的 12 位令牌。
4. 或者什么都不做：默认会自动互加（只读），双方都出现对方。

要求：同一广播域、UDP 45871 可达、没有 AP 隔离。跨 VLAN/企业 WiFi 用 3.3 的接入码。

### 3.2 远程主节点（有公网/常开机器）

适合旧电脑、NAS、云服务器。

**Hub 侧**

1. 安装插件并重启；打开「节点监控」→「远程主节点」。
2. 记录「加入地址」（如 `http://10.0.0.5:45873`、`http://100.x.x.x:45873`、`https://dsh.example.com`）与「加入令牌」。
3. 需要跨公网时，给 Hub 配 Tailscale，或反代 + `publicUrl`。

**PC 侧**

1. 「远程主节点」→ 地址、令牌 → 连接。
2. 状态变成「已连接 …」即可；Hub 面板会显示该 PC（标签「远程」）。
3. 控制：Hub 端只能插件启停/列表（PC 端需 `DSH_NODE_MONITOR_ALLOW_CONTROL=1`）。

要求：PC 能出站访问 Hub 的 45873；Hub 防火墙放行入站 45873。**不需要**开放 DSH 3081。

### 3.3 没有服务器：接入码 + 虚拟局域网 / IPv6

1. 两台安装 v0.6.4 并重启。
2. A：「本机配对信息」→「接入码」→ 选地址（LAN/Tailscale 100.x/IPv6）→ 复制链接/二维码。
3. B：「添加节点」→ 粘贴到**节点地址**栏 → 自动填地址和令牌 → 保存。
4. 自测：

   ```bash
   curl http://<A地址>:45873/node-monitor/api/v1/health
   curl -6 "http://[<A的IPv6>]:45873/node-monitor/api/v1/health"
   ```

推荐网络：Tailscale（免费额度、无需公网）、ZeroTier（二层，可能直接广播发现）、公网 IPv6（双方都要有，防火墙放行 45873）、cloudflared 隧道（给 Hub 用）。

### 3.4 域名 / 反向代理

```yaml
- id: node-monitor
  name: 'dsh-node-monitor'
  config:
    publicUrl: 'https://dsh.example.com'
```

- 反代只需要把 `/` 转到 DSH 的 3081；加入链接/二维码会使用 `publicUrl`。
- 若反代不转发 45873，Hub 客户端仍可通过 HTTPS 访问 push/result（反代放行路径即可）。
- 面板 origin 顺序：`config.publicUrl` → `DSH_NODE_MONITOR_PUBLIC_URL` → `webApp.getAdvertisedUrl()` → `webServer.getOrigin()`。

## 4. 端口与防火墙

| 端口 | 协议 | 用途 | 谁访问谁 |
| --- | --- | --- | --- |
| 3081（或反代 443） | TCP | DSH Web、面板、open 路由 | 浏览器 → 本机 |
| 45873 | TCP | agent：status/health/pair/control/hub | 其他 DSH → 本机；本机 → Hub |
| 45871 | UDP | 局域网发现（组播+广播） | 同一广播域 |

Windows：首次运行会弹「允许访问」，或手动在「Windows Defender 防火墙 → 允许应用」放行 node。  
Linux：`ufw allow 45873/tcp && ufw allow 45871/udp`。  
云服务器安全组：至少放行 45873/tcp；发现用不到就不开 UDP。

## 5. 令牌与开关

- 面板「本机配对信息」：节点 ID、显示名、连接令牌（显示/复制/重新生成）、接入码。
- 令牌文件：`~/.dsh/node-monitor/secrets.json`（0600）。**不要**把它拷到不可信机器。
- 升级 v0.6.3+ 后建议「重新生成」一次，让旧版自动配对留下的完整令牌失效。
- 关闭运维控制（默认已关）：不设置 `allowControl` 即可；或显式：

  ```bash
  DSH_NODE_MONITOR_ALLOW_CONTROL=0
  DSH_NODE_MONITOR_ALLOW_RESTART=0
  ```

- 关闭 Hub 接收：`DSH_NODE_MONITOR_HUB=0`。
- 关闭自动发现/自动配对：`DSH_NODE_MONITOR_DISCOVERY=0`、`DSH_NODE_MONITOR_AUTO_PAIR=0`。
- 临时停用整个插件：`DSH_NODE_MONITOR_DISABLE=1`（或配置 `enabled: false`）。

## 6. 升级与回滚

1. 备份：`cp -a ~/.dsh/node-monitor ~/node-monitor-backup-$(date +%F)`。
2. 面板「添加插件」填新 tag 的 tarball → 安装。
3. **重启 DSH**（宿主代码更新必须重启；仅客户端变更刷新页面即可）。
4. 回滚：重复安装旧 tag，重启；`state.json` 向后兼容。
5. 降级到 v0.6.2 以下会失去只读令牌与 45873 双栈，建议不要跨大版本回滚。

## 7. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 左侧栏没有入口 | 插件未启用/宿主未重启 | 插件页确认启用，重启 DSH |
| 节点一直离线 | 对端 45873 不可达 | `curl http://对端:45873/node-monitor/api/v1/health`；放行防火墙 |
| 局域网发现为空 | 不同广播域 / AP 隔离 / UDP 未放行 | 用接入码手工添加，或改用 Hub |
| 「未配对」且打开 401 | 未保存登录材料，或目标重启后令牌轮换 | 编辑节点粘贴新的登录地址 |
| 加入链接打开是 127.0.0.1 | 未配置 publicUrl | 配 `DSH_NODE_MONITOR_PUBLIC_URL` |
| 控制 403 | 节点未开 allowControl，或自动节点只读 | 节点侧开启控制；编辑节点粘贴完整令牌 |
| 控制 401 | 令牌错误/已轮换 | 重新复制对方连接令牌 |
| 批量/控制 `unknown-endpoint` | 宿主还在旧代码 | 重启 DSH |
| Hub 看不到 PC | PC 未连接 / Hub 45873 不可达 / 令牌错 | PC 面板看「已连接」；`curl` Hub 45873 |
| 内存上涨 | 历史 bug（v0.6.3 已修 Hub 队列/peer 无上限） | 升级 v0.6.3；观察 `hubPeers` 数 |

## 8. 卸载

1. 插件页停用「多 DSH 节点监控」。
2. 删除 bundle 条目（profile `package.json` 的 `dsh.profile.bundles` 与 dependencies）。
3. 重启 DSH。
4. 可选删除数据：`rm -rf ~/.dsh/node-monitor`（会丢失节点与令牌）。

## 9. 从旧版本迁移

| 起点 | 动作 |
| --- | --- |
| v0.3/v0.4 | 直接升 v0.6.3；重新生成令牌；旧自动节点删除后重加 |
| v0.5 | 升级后重启，45873 才生效；检查防火墙 |
| v0.6.0–v0.6.2 | 升级 v0.6.3；轮换令牌；旧自动节点会自行去重（remoteId） |
| 无插件 | 按第 1 节安装 |

## 10. 获取帮助

- 先看 [故障排查](../README.md#故障排查) 与本文第 7 节。
- 收集：DSH 版本、OS、插件版本、`~/.dsh/node-monitor/` 目录权限、`/health` 返回、浏览器 console 错误。
- 不要附带 `secrets.json` 原文；如必须，先轮换令牌。
