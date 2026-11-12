# 在两台 PC 上安装并互联（v0.3.1）

本包是 DSH 的 bundle 插件，**不需要联网安装依赖**（无运行时依赖）。两台机器各装一次，然后在一台的面板里把另一台加为节点即可。

## 0. 包内容

- `dsh-node-monitor-0.3.1.tgz`：npm 打包产物（`package/` 目录 + 源码/文档/截图）
- `dsh-node-monitor-0.3.1.zip`：同样的内容，外层目录名已是 `dsh-node-monitor/`，Windows 直接解压
- `SHA256SUMS`：校验和

## 1. 解压

Windows（PowerShell）：

```powershell
Expand-Archive .\dsh-node-monitor-0.3.1.zip -DestinationPath C:\dsh-plugins
# 得到 C:\dsh-plugins\dsh-node-monitor
```

Linux / macOS：

```bash
tar xzf dsh-node-monitor-0.3.1.tgz && mv package dsh-node-monitor
# 或 unzip dsh-node-monitor-0.3.1.zip
```

## 2. 安装（两种方式，选一种）

### 方式 A：让 DSH Agent 装（推荐）

在该 PC 的 DSH 会话里说：

> 安装本地 bundle：`C:\dsh-plugins\dsh-node-monitor`（Linux 填解压后的绝对路径），然后重启 DSH。

Agent 会调用 `plugin_manager install_bundle`，把包写进 profile 的 `dependencies` 和 `dsh.profile.bundles`。

### 方式 B：手动登记到 profile

编辑 `~/.dsh/profiles/web/package.json`（Windows 是 `C:\Users\<你>\.dsh\profiles\web\package.json`）：

1. `dependencies` 增加：
   ```json
   "dsh-node-monitor": "link:C:/dsh-plugins/dsh-node-monitor"
   ```
   （Linux/macOS 用绝对路径，例如 `"link:/opt/dsh-plugins/dsh-node-monitor"`）
2. `dsh.profile.bundles` 数组末尾加 `"dsh-node-monitor"`
3. 重启 DSH。

> 不要改 `cordis.patch.yml`——本包自带 `dsh.bundle.patch`，bundle 加载时自动插入。

## 3. 让另一台机器能访问本机 DSH

DSH 默认只监听 `127.0.0.1`，**别的机器连不上**。必须绑定到一张真实网卡地址（DSH 拒绝 `0.0.0.0` 通配）：

```bash
# 同一局域网：用本机局域网 IP（Windows: ipconfig 看 IPv4）
dsh --profile web --host 192.168.1.23 --port 3081

# 不在同一网络：先装 Tailscale，两台都登录，用它给的 100.x 地址
dsh --profile web --host 100.101.102.103 --port 3081
```

- Windows 首次运行放行防火墙（或手动放行 TCP 3081 / 你选的端口）；
- 若要用「局域网自动发现」，还需放行 **UDP 45871**（入站）；不想开也能手动添加节点；
- 启动日志会打印 `dsh web: http://<host>:<port>/?token=...`，用这个地址打开本机 GUI；
- 验证从另一台机器可访问：`curl http://<IP>:3081/node-monitor/api/v1/health` 应返回 `200`。

## 4. 取节点令牌

每台机器装好后自动生成（0600）：

- Linux/macOS：`~/.dsh/node-monitor/secrets.json`
- Windows：`C:\Users\<你>\.dsh\node-monitor\secrets.json`

里面的 `agentToken`（48 位十六进制）就是被别的 Hub 探测时要带的令牌。**不要发到公开渠道**；只在两台你自己的机器间复制。

## 5. 在 Hub 上添加对端

打开 A 的 GUI → 左侧栏「节点监控」→「添加节点」：

| 字段 | 填什么 |
| --- | --- |
| 节点名称 | `PC-B` 之类 |
| 节点地址 | `http://<B 的 IP>:3081`（B 启动时 `--host` 的那个地址） |
| 接入适配器 | `DSH` |
| 代理令牌 | 粘贴 B 的 `agentToken` |
| 标签/备注 | 可选，如 `家里 / 主力机` |

保存 → 卡片变「在线」并出现 B 的 CPU/内存/磁盘/延迟即互联成功。B 的防火墙/端口没放开时会是「离线 / 无法连接」。

## 6. 配对「打开 / 内嵌」（可选）

只做监控不需要这一步。要让 A 里直接跳进 B 的真实 DSH 界面：

1. 在 B 的 GUI 地址栏取带 `?token=` 的登录 URL（B 启动日志里的那条；token 会随重启轮换）；
2. A 的节点卡片「⋯ / 编辑」→ 登录材料 → 粘贴该 URL → 保存；
3. 同域（A、B 同一主机名后缀）可「内嵌」，跨域会降级为新标签页（DSH Cookie 按 authority 绑定，属预期）。

## 7. 运维控制（可选，默认关闭）

B 侧需要显式开启后重启：

```bash
# Linux/macOS
DSH_NODE_MONITOR_ALLOW_CONTROL=1 dsh --profile web --host <IP> --port 3081
# 需要远程重启再加
DSH_NODE_MONITOR_ALLOW_RESTART=1
```

Windows（PowerShell）：

```powershell
$env:DSH_NODE_MONITOR_ALLOW_CONTROL="1"; dsh --profile web --host <IP> --port 3081
```

开启后 A 的节点详情出现「运维控制」：插件列表 / 行内确认启停 / 二次确认重启；所有操作写 B 的 `~/.dsh/node-monitor/audit.jsonl`（0600）。

## 8. 验收清单

- [ ] 两台机器 `/node-monitor/api/v1/health` 都是 200
- [ ] 两边左侧栏都有「节点监控」，面板能打开
- [ ] A 添加 B 后显示「在线」，CPU/延迟随刷新变化
- [ ] 把 B 的进程停掉 → A 约 10 秒后出现「节点离线」告警；确认后归零
- [ ] （可选）会话概览只显示 ID/状态/模型/目录/时间，无对话内容
- [ ] （可选）批量勾选 2 个节点 → 批量探测/停用/启用生效

## 9. 常见问题

| 现象 | 处理 |
| --- | --- |
| A 里 B 一直离线 | B 是否用 `--host` 绑了真实网卡？防火墙放行？`curl http://B:3081/node-monitor/api/v1/health` 通不通？ |
| 状态接口 401 | 令牌不对/未填。令牌取 B 的 `secrets.json` 的 `agentToken` |
| 「打开」报 401 / 登录页 | B 重启过，token 轮换了 → 重新粘贴登录 URL |
| 内嵌按钮提示跨站 | 预期：跨域不能 iframe；用「打开」新标签页 |
| 控制区提示未开启 | B 未设 `allowControl`，或设了没重启 |
| 装完没出现左侧栏入口 | 重启 DSH；确认 profile `dsh.profile.bundles` 含 `dsh-node-monitor`；看 DSH 日志有无 `slot entry crashed` |
| 批量按钮报 unknown-endpoint | 宿主半还是旧代码，重启 DSH |

## 10. 卸载

1. 从 profile `package.json` 的 `dsh.profile.bundles` 删除 `dsh-node-monitor`，并删除对应 `dependencies`；
2. 重启 DSH；
3. 可选：删除 `~/.dsh/node-monitor/`（含令牌与历史，删除前备份）。

## 局域网自动发现（可选，v0.4.0+）

同一 WiFi / 同一网段下：

1. 两台都按上面的方式用 `--host <局域网IP>` 启动；
2. 任一台打开「节点监控」→「本机配对信息」→ 点「显示」查看连接令牌（可「重新生成」为 `XXXX-XXXX-XXXX` 易读格式，可「改名」成自己的机器名）；
3. 另一台在同面板「局域网发现」里看到对方 →「接入」→ 粘贴令牌 → 保存。

说明：广播只含名称/地址/端口/版本/节点 ID，不含令牌；接入必须拿到对方令牌；发现仅同一广播域有效，跨网请用 Tailscale 或 frp。若企业 WiFi 拦截广播，可退回「添加节点」手填地址。
