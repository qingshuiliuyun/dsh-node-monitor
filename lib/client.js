/* global window, document */
/**
 * dsh-node-monitor — 浏览器侧 bundle。
 *
 * 只依赖浏览器模块表里的 react，通过 DSH 已认证的 Connection RPC
 * 与宿主插件通信；不包含任何令牌、不请求第三方资源。
 */
window.__ModuleLoader__.load({
  id: 'dsh-node-monitor',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    const PLUGIN_ID = 'dsh-node-monitor'
    const PANEL_ID = 'node-monitor'
    const NS = 'node-monitor'
    const RPC_CHANNEL = '/node-monitor-rpc'
    const ORDER = 20

    /* -------------------------------------------------------------- */
    /* 文案                                                            */
    /* -------------------------------------------------------------- */

    const ZH = {
      panel: '节点监控',
      title: '多 DSH 节点监控',
      subtitle: '在手机、PC 与浏览器上统一查看各 DSH 实例的工作状态',
      'actions.refresh': '刷新',
      'actions.add': '添加节点',
      'actions.settings': '设置',
      'actions.close': '关闭',
      'actions.cancel': '取消',
      'actions.save': '保存',
      'actions.back': '返回总览',
      'actions.edit': '编辑',
      'actions.remove': '移除',
      'actions.enable': '启用',
      'actions.disable': '停用',
      'actions.probe': '立即探测',
      'actions.test': '测试连接',
      'actions.open': '打开',
      'actions.openNode': '打开节点',
      'actions.loginSave': '保存登录材料',
      'actions.loginClear': '清除',
      'actions.ack': '确认',
      'actions.ackAll': '全部确认',
      'actions.retry': '重试',
      'summary.nodes': '节点',
      'summary.online': '在线',
      'summary.degraded': '异常',
      'summary.offline': '离线',
      'summary.alerts': '未确认告警',
      'status.unknown': '未知',
      'status.online': '在线',
      'status.degraded': '不稳定',
      'status.offline': '离线',
      'adapter.dsh': 'DSH',
      'adapter.generic': '通用 HTTP',
      'empty.title': '还没有可用的节点视图',
      'empty.desc': '本机自检节点会自动接入；在其它 DSH 节点启用 dsh-node-monitor 并配置相同的代理令牌后，即可在这里统一查看。',
      'empty.add': '接入节点',
      'token.title': '节点代理令牌',
      'token.enabled': '已启用',
      'token.source.env': '来源：环境变量',
      'token.source.file': '来源：本机密钥文件（0600）',
      'token.hint': '令牌只保存在宿主侧，页面不会显示。远端节点可通过 DSH_NODE_MONITOR_TOKEN 配置同一令牌。',
      'token.missing': '未配置',
      'token.saved': '已保存',
      'node.latency': '延迟',
      'node.lastSeen': '最近在线',
      'node.checkedAt': '最近探测',
      'node.never': '从未',
      'node.sessions': '会话',
      'node.sessionRunning': '运行中',
      'node.cpu': 'CPU',
      'node.mem': '内存',
      'node.diskFree': '磁盘可用',
      'node.load': '负载',
      'node.uptime': '运行时长',
      'node.host': '主机',
      'node.adapter': '适配器',
      'node.baseUrl': '节点地址',
      'node.tags': '标签',
      'node.token': '代理令牌',
      'node.error': '最近错误',
      'node.noProbe': '尚未探测',
      'node.self': '本机',
      'node.failures': '连续失败',
      'node.protocol': '协议',
      'node.hostname': '主机名',
      'node.open': '打开 DSH',
      'node.pairedTag': '双向',
      'node.autoTag': '自动',
      'node.openHint': '在新标签页打开该节点的真实 DSH 界面',
      'node.network': '网络',
      'node.login': '登录材料',
      'node.notes': '备注',
      'login.configured': '已配对',
      'login.missing': '未配对',
      'login.savedHost': '已保存：{host}',
      'login.afterSave': '保存节点后，可在编辑里配对登录地址，实现一键打开。',
      'login.needRestart': '宿主侧尚未加载 v0.2.0（登录材料与一键打开）。重启一次 DSH 并刷新本页后即可使用；当前「打开」会直接跳到节点地址。',
      'network.lan': '内网',
      'network.tailscale': 'Tailscale',
      'network.tunnel': '隧道',
      'network.public': '公网',
      'network.internet': '公网',
      'modal.addTitle': '添加 DSH 节点',
      'modal.editTitle': '编辑节点',
      'modal.name': '节点名称',
      'modal.namePlaceholder': '留空则自动读取远端主机名',
      'modal.nameAuto': '留空即可：接入成功后自动使用远端主机名（不可达时用地址里的主机名）。',
      'modal.baseUrl': '节点地址',
      'modal.baseUrlPlaceholder': 'https://node.example.com',
      'modal.adapter': '接入适配器',
      'modal.path': '健康检查路径',
      'modal.token': '代理令牌',
      'modal.tokenPlaceholder': '粘贴节点代理令牌（本机自检节点无需填写）',
      'modal.tokenKeep': '留空表示保持现有令牌不变',
      'modal.tokenScoped': '令牌只写入宿主侧的 0600 密钥文件，不会回显到页面或日志。',
      'modal.enabled': '启用周期探测',
      'modal.testOk': '连接成功，延迟 {latency}',
      'modal.testFail': '连接失败：{reason}',
      'modal.networkLabel': '网络位置',
      'modal.notes': '备注',
      'modal.notesPlaceholder': '例如：机房 / 用途（可选）',
      'modal.loginSection': '登录材料（用于一键打开）',
      'modal.loginHint': '粘贴该节点启动时打印的 …?token=… 地址。令牌只写入宿主侧 0600 密钥文件，页面不回显、不写日志。',
      'modal.loginPlaceholder': 'https://node.example.com/?token=…',
      'modal.loginEmpty': '尚未配对登录地址，打开时将落到节点地址。',
      'modal.settingsTitle': '监控设置',
      'modal.refreshMs': '刷新间隔（毫秒）',
      'modal.timeoutMs': '探测超时（毫秒）',
      'modal.latencyWarnMs': '延迟告警阈值（毫秒）',
      'modal.cpuWarnPct': 'CPU 告警阈值（%）',
      'modal.memWarnPct': '内存告警阈值（%）',
      'modal.diskWarnFreePct': '磁盘可用告警阈值（%）',
      'alerts.title': '告警',
      'alerts.empty': '当前没有未确认告警',
      'alerts.acked': '已确认',
      'alerts.ack': '确认',
      'alert.node.offline': '节点离线：{name}',
      'alert.node.unstable': '节点探测异常：{name}',
      'alert.node.protocol': '协议版本不一致：{name}',
      'alert.node.latency': '延迟偏高：{name}',
      'alert.node.cpu': 'CPU 使用率偏高：{name}',
      'alert.node.mem': '内存使用率偏高：{name}',
      'alert.node.disk': '磁盘可用空间不足：{name}',
      'alert.node.remote': '节点自定义告警：{name}（{code}）',
      'alert.value': '当前值 {value}',
      'alert.reason': '原因：{reason}',
      'events.title': '最近活动',
      'sessions.title': '会话概览',
      'sessions.empty': '该节点暂无活跃会话',
      'sessions.running': '运行中',
      'sessions.idle': '空闲',
      'sessions.sub': '子会话',
      'sessions.hint': '只读：仅展示会话 ID、状态、模型、工作目录与最近活动时间，不读取对话内容。',
      'filter.search': '搜索节点',
      'filter.searchPlaceholder': '名称 / 地址',
      'filter.statusAll': '全部状态',
      'filter.tagAll': '全部分组',
      'filter.count': '{shown} / {total} 个节点',
      'filter.clear': '清除筛选',
      'batch.selected': '已选 {count} 个节点',
      'self.title': '本机配对信息',
      'self.hint': '在另一台 DSH 的「添加节点」里填入本机地址与这个令牌；令牌相当于密码，只发给你自己的设备。',
      'self.id': '节点 ID',
      'self.label': '显示名称',
      'self.token': '连接令牌',
      'self.reveal': '显示',
      'self.hide': '隐藏',
      'self.copy': '复制',
      'self.copied': '令牌已复制',
      'self.copyFailed': '复制失败，请手动选中文本',
      'self.rotate': '重新生成',
      'self.invite': '接入码',
      'invite.title': '供其他电脑接入本机',
      'invite.hint': '选一个本机地址，复制链接让对方在「添加节点」里粘贴；局域网/NAS/Tailscale/ZeroTier/IPv6 均可用。',
      'invite.address': '接入地址',
      'invite.warn': '接入链接里含本机令牌，等同于密码；只发给你自己的设备。',
      'invite.copy': '复制接入链接',
      'invite.copied': '接入链接已复制',
      'invite.qr': '二维码',
      'invite.qrClose': '关闭',
      'invite.close': '收起',
      'modal.linkParsed': '已从接入链接填入地址与令牌',
      'self.rotateConfirm': '重新生成后，已接入本机的其他节点会立即失效，确认？',
      'self.confirm': '确认',
      'self.rename': '改名',
      'self.save': '保存',
      'self.renamed': '名称已更新',
      'self.cancel': '取消',
      'self.rotated': '新令牌已生成',
      'hub.title': '远程主节点',
      'hub.hint': '把服务器上的 DSH 作为主节点：其他电脑填入这里的地址与加入令牌即可自动接入。',
      'hub.connectTitle': '连接到远程主节点',
      'hub.connectHint': '在一台电脑上填主节点地址与加入令牌，之后自动上报，无需公网 IP。',
      'hub.origin': '加入地址',
      'hub.token': '加入令牌',
      'hub.urlLabel': '主节点地址',
      'hub.urlPlaceholder': 'https://dsh.example.com',
      'hub.tokenPlaceholder': '主节点「本机配对信息」里的加入令牌',
      'hub.connect': '连接',
      'hub.disconnect': '断开',
      'hub.connected': '已连接',
      'hub.peers': '已接入节点',
      'hub.copyLink': '复制加入链接',
      'hub.linkCopied': '加入链接已复制',
      'hub.qr': '二维码',
      'hub.qrTitle': '扫码加入',
      'hub.qrHint': '用手机扫码打开主节点页面；令牌只在链接 # 片段里，不会发送给服务器。',
      'hub.qrClose': '关闭',
      'hub.joinParsed': '已从加入链接填入地址与令牌，点「连接」完成。',
      'hub.copyLinkFailed': '复制失败，请手动选择链接',
      'hub.showToken': '显示令牌',
      'hub.hideToken': '隐藏',
      'hub.copy': '复制',
      'hub.copied': '已复制',
      'hub.rotate': '重新生成',
      'hub.rotateConfirm': '重新生成后已接入的电脑需要重新填写，确认？',
      'hub.rotated': '加入令牌已重新生成',
      'hub.failed': '连接失败',
      'event.hubLinked': '已接入远程主节点',
      'event.hubUnlinked': '已断开远程主节点',
      'event.hubPeerJoined': '远程节点已接入：{name}',
      'node.hubTag': '远程',
      'discovery.title': '局域网发现',
      'discovery.hint': '只广播名称与地址，不含令牌；接入需粘贴对方令牌。',
      'discovery.empty': '暂未发现同局域网内的其他 DSH',
      'discovery.probe': '重新扫描',
      'discovery.join': '接入',
      'discovery.added': '已接入',
      'discovery.prefillHint': '已填入发现到的地址，请粘贴对方的连接令牌。',
      'batch.all': '全选当前',
      'batch.probe': '批量探测',
      'batch.enable': '批量启用',
      'batch.disable': '批量停用',
      'batch.clear': '清除选择',
      'toast.batchProbe': '已探测 {count} 个节点',
      'toast.batchEnable': '已启用 {count} 个节点',
      'toast.batchDisable': '已停用 {count} 个节点',
      'event.batchProbed': '批量探测：{count} 个节点',
      'event.batchEnabled': '批量启用：{count} 个节点',
      'event.batchDisabled': '批量停用：{count} 个节点',
      'filter.empty': '没有符合筛选条件的节点',
      'control.title': '运维控制',
      'control.disabled': '该节点未开启运维控制（节点侧设置 allowControl: true 后重启 DSH 生效）。',
      'control.readOnlyHint': '自动接入的节点是只读的（只交换只读令牌）；如需远程运维，请编辑节点并粘贴对方的完整连接令牌。',
      'control.audit': '每次操作都会写入节点侧 ~/.dsh/node-monitor/audit.jsonl（0600，不含令牌）。',
      'control.plugins': '插件列表',
      'control.load': '加载插件',
      'control.reload': '刷新列表',
      'control.loading': '读取中…',
      'control.empty': '没有可控制的插件',
      'control.enable': '启用',
      'control.disable': '禁用',
      'control.readOnly': '只读',
      'control.confirmToggle': '确认{verb} {name}？',
      'control.confirm': '确认',
      'control.cancel': '取消',
      'control.restart': '重启节点',
      'control.restartConfirm': '重启会让该节点短暂离线，确认重启？',
      'control.restarted': '重启指令已发出',
      'control.failed': '读取插件列表失败',
      'control.enabled': '已启用',
      'control.disabledChip': '已禁用',
      'embed.actions': '内嵌打开',
      'embed.short': '内嵌',
      'embed.hint': '同机（同主机名、任意端口）可内嵌；跨机需同站点域名或改用新标签打开。',
      'embed.crossSite': '跨站节点不支持内嵌（浏览器 SameSite 限制），请在新标签打开。',
      'embed.openTab': '新标签打开',
      'embed.close': '关闭内嵌',
      'embed.loading': '正在打开节点…',
      'embed.failed': '内嵌打开失败',
      'events.empty': '暂无活动',
      'event.node.online': '节点恢复在线：{name}',
      'event.node.offline': '节点离线：{name}',
      'event.node.degraded': '节点探测异常：{name}',
      'event.node.unknown': '节点状态未知：{name}',
      'event.nodeAdded': '已接入节点：{name}',
      'event.nodeUpdated': '已更新节点：{name}',
      'event.nodePaired': '双向配对：{name}',
      'event.nodeAutoPaired': '自动配对：{name}',
      'event.tokenRotated': '连接令牌已重新生成',
      'event.tokenRotated': 'Access token regenerated',
      'event.loginSaved': '已保存登录材料：{name}',
      'event.loginCleared': '已清除登录材料：{name}',
      'event.nodeRemoved': '已移除节点：{name}',
      'event.agentRunning': '代理开始运行：{agent}',
      'event.agentIdle': '代理回到空闲：{agent}',
      'event.agentCreated': '新建代理：{agent}',
      'event.agentDisposed': '代理已释放：{agent}',
      'reason.auth': '认证失败（令牌未配置、错误或已轮换）',
      'reason.timeout': '探测超时',
      'reason.unreachable': '无法连接节点，请检查地址、端口与网络',
      'reason.not-found': '端点不存在，请确认节点已启用监控插件',
      'reason.bad-json': '节点返回的不是合法 JSON',
      'reason.protocol': '协议版本不一致',
      'reason.remote-unhealthy': '节点标记自身为不健康状态',
      'reason.http-status': '节点返回错误状态码',
      'reason.offline': '远程节点已失联',
      'error.generic': '操作失败：{message}',
      'error.crash': '面板渲染出现异常，已自动隔离。刷新页面后可重试。',
      'error.forbidden': '没有权限执行此操作',
      'error.limit-reached': '节点数量已达上限',
      'time.justNow': '刚刚',
      'time.secondsAgo': '{n} 秒前',
      'time.minutesAgo': '{n} 分钟前',
      'time.hoursAgo': '{n} 小时前',
      'time.daysAgo': '{n} 天前',
      'uptime.text': '{d} 天 {h} 小时',
      'uptime.short': '{h} 小时 {m} 分',
      'footer.meta': '协议 {protocol} · 本机 {hostname}',
      'toast.opened': '已在新标签页打开',
      'toast.openFailed': '打开失败：{reason}',
      'toast.openFallback': '宿主侧版本尚未更新，已直接打开节点地址；重启 DSH 后可免登录打开',
      'toast.loginSaved': '登录材料已保存',
      'toast.loginCleared': '登录材料已清除',
      'error.openUnavailable': '该节点无法打开',
      'error.login-url-invalid': '登录地址不合法（仅支持 http/https URL）',
      'confirm.removeTitle': '移除节点',
      'confirm.removeBody': '确定要移除「{name}」吗？该操作只删除本地配置，不影响远端节点。',
      'confirm.remove': '确认移除',
      'loading': '正在加载…',
      'error.bad-json': '响应格式异常',
      'toast.saved': '已保存',
      'toast.acked': '已确认',
      'toast.probed': '已完成探测'
    }

    const EN = {
      panel: 'Nodes',
      title: 'DSH Node Monitor',
      subtitle: 'Every DSH instance at a glance — phone, desktop and browser',
      'actions.refresh': 'Refresh',
      'actions.add': 'Add node',
      'actions.settings': 'Settings',
      'actions.close': 'Close',
      'actions.cancel': 'Cancel',
      'actions.save': 'Save',
      'actions.back': 'Overview',
      'actions.edit': 'Edit',
      'actions.remove': 'Remove',
      'actions.enable': 'Enable',
      'actions.disable': 'Disable',
      'actions.probe': 'Probe now',
      'actions.test': 'Test connection',
      'actions.open': 'Open',
      'actions.openNode': 'Open node',
      'actions.loginSave': 'Save login',
      'actions.loginClear': 'Clear',
      'actions.ack': 'Acknowledge',
      'actions.ackAll': 'Acknowledge all',
      'actions.retry': 'Retry',
      'summary.nodes': 'Nodes',
      'summary.online': 'Online',
      'summary.degraded': 'Degraded',
      'summary.offline': 'Offline',
      'summary.alerts': 'Open alerts',
      'status.unknown': 'Unknown',
      'status.online': 'Online',
      'status.degraded': 'Degraded',
      'status.offline': 'Offline',
      'adapter.dsh': 'DSH',
      'adapter.generic': 'Generic HTTP',
      'empty.title': 'No node view yet',
      'empty.desc': 'The loopback self-check node is added automatically. Enable dsh-node-monitor on another DSH host with the same agent token to see it here.',
      'empty.add': 'Add a node',
      'token.title': 'Node agent token',
      'token.enabled': 'Enabled',
      'token.source.env': 'Source: environment',
      'token.source.file': 'Source: local 0600 secret file',
      'token.hint': 'The token stays on the host and is never shown here. A remote node uses the same token via DSH_NODE_MONITOR_TOKEN.',
      'token.missing': 'Not configured',
      'token.saved': 'Saved',
      'node.latency': 'Latency',
      'node.lastSeen': 'Last seen',
      'node.checkedAt': 'Last probe',
      'node.never': 'never',
      'node.sessions': 'Sessions',
      'node.sessionRunning': 'running',
      'node.cpu': 'CPU',
      'node.mem': 'Memory',
      'node.diskFree': 'Disk free',
      'node.load': 'Load',
      'node.uptime': 'Uptime',
      'node.host': 'Host',
      'node.adapter': 'Adapter',
      'node.baseUrl': 'Base URL',
      'node.tags': 'Tags',
      'node.token': 'Agent token',
      'node.error': 'Last error',
      'node.noProbe': 'Not probed yet',
      'node.self': 'self',
      'node.failures': 'Consecutive failures',
      'node.protocol': 'Protocol',
      'node.hostname': 'Hostname',
      'node.open': 'Open DSH',
      'node.pairedTag': 'Paired',
      'node.autoTag': 'Auto',
      'node.openHint': 'Open this node’s real DSH UI in a new tab',
      'node.network': 'Network',
      'node.login': 'Login material',
      'node.notes': 'Notes',
      'login.configured': 'Paired',
      'login.missing': 'Not paired',
      'login.savedHost': 'Saved: {host}',
      'login.afterSave': 'Save the node first, then pair its login URL in Edit for one-click open.',
      'login.needRestart': 'Host side has not loaded v0.2.0 yet (login pairing + one-click open). Restart DSH and refresh this page; for now “Open” jumps to the node base URL.',
      'network.lan': 'LAN',
      'network.tailscale': 'Tailscale',
      'network.tunnel': 'Tunnel',
      'network.public': 'Public',
      'network.internet': 'Internet',
      'modal.addTitle': 'Add DSH node',
      'modal.editTitle': 'Edit node',
      'modal.name': 'Name',
      'modal.namePlaceholder': 'Leave blank to use the remote hostname',
      'modal.nameAuto': 'Optional: when blank, the remote hostname is used automatically (falls back to the URL host).',
      'modal.baseUrl': 'Base URL',
      'modal.baseUrlPlaceholder': 'https://node.example.com',
      'modal.adapter': 'Adapter',
      'modal.path': 'Health path',
      'modal.token': 'Agent token',
      'modal.tokenPlaceholder': 'Paste the node agent token (not needed for loopback)',
      'modal.tokenKeep': 'Leave empty to keep the current token',
      'modal.tokenScoped': 'The token is written to the host-side 0600 secret file only; it is never echoed to the page or logs.',
      'modal.enabled': 'Enable periodic probing',
      'modal.testOk': 'Connected in {latency}',
      'modal.testFail': 'Connection failed: {reason}',
      'modal.networkLabel': 'Network location',
      'modal.notes': 'Notes',
      'modal.notesPlaceholder': 'e.g. datacenter / purpose (optional)',
      'modal.loginSection': 'Login material (for one-click open)',
      'modal.loginHint': 'Paste the …?token=… URL this node printed on startup. The token is stored only in the host-side 0600 secrets file; it is never echoed to the page or logs.',
      'modal.loginPlaceholder': 'https://node.example.com/?token=…',
      'modal.loginEmpty': 'No login URL paired; opening the node falls back to its base URL.',
      'modal.settingsTitle': 'Monitor settings',
      'modal.refreshMs': 'Refresh interval (ms)',
      'modal.timeoutMs': 'Probe timeout (ms)',
      'modal.latencyWarnMs': 'Latency alert threshold (ms)',
      'modal.cpuWarnPct': 'CPU alert threshold (%)',
      'modal.memWarnPct': 'Memory alert threshold (%)',
      'modal.diskWarnFreePct': 'Disk free alert threshold (%)',
      'alerts.title': 'Alerts',
      'alerts.empty': 'No open alerts',
      'alerts.acked': 'acknowledged',
      'alerts.ack': 'Acknowledge',
      'alert.node.offline': 'Node offline: {name}',
      'alert.node.unstable': 'Node probe failing: {name}',
      'alert.node.protocol': 'Protocol mismatch: {name}',
      'alert.node.latency': 'High latency: {name}',
      'alert.node.cpu': 'High CPU: {name}',
      'alert.node.mem': 'High memory: {name}',
      'alert.node.disk': 'Low disk space: {name}',
      'alert.node.remote': 'Node alert: {name} ({code})',
      'alert.value': 'Current value {value}',
      'alert.reason': 'Reason: {reason}',
      'events.title': 'Recent activity',
      'sessions.title': 'Sessions',
      'sessions.empty': 'No active sessions on this node',
      'sessions.running': 'running',
      'sessions.idle': 'idle',
      'sessions.sub': 'sub-agent',
      'sessions.hint': 'Read-only: session id, status, model, working directory and last activity — never conversation content.',
      'filter.search': 'Search nodes',
      'filter.searchPlaceholder': 'name / address',
      'filter.statusAll': 'All statuses',
      'filter.tagAll': 'All groups',
      'filter.count': '{shown} / {total} nodes',
      'filter.clear': 'Clear filters',
      'batch.selected': '{count} nodes selected',
      'self.title': 'This node',
      'self.hint': 'On the other DSH, use Add node with this address and the token below. Treat the token like a password; share it only with your own devices.',
      'self.id': 'Node ID',
      'self.label': 'Display name',
      'self.token': 'Access token',
      'self.reveal': 'Show',
      'self.hide': 'Hide',
      'self.copy': 'Copy',
      'self.copied': 'Token copied',
      'self.copyFailed': 'Copy failed, select the text manually',
      'self.rotate': 'Regenerate',
      'self.invite': 'Invite',
      'invite.title': 'Let other computers add this node',
      'invite.hint': 'Pick a local address and copy the link; paste it into “Add node” on the other machine. Works for LAN, NAS, Tailscale, ZeroTier and IPv6.',
      'invite.address': 'Endpoint',
      'invite.warn': 'The invite link contains this node token — treat it like a password and only send it to your own devices.',
      'invite.copy': 'Copy invite link',
      'invite.copied': 'Invite link copied',
      'invite.qr': 'QR code',
      'invite.qrClose': 'Close',
      'invite.close': 'Close',
      'modal.linkParsed': 'Filled address and token from the invite link',
      'self.rotateConfirm': 'Regenerating invalidates existing peers immediately. Continue?',
      'self.confirm': 'Confirm',
      'self.rename': 'Rename',
      'self.save': 'Save',
      'self.renamed': 'Name updated',
      'self.cancel': 'Cancel',
      'self.rotated': 'New token generated',
      'hub.title': 'Remote hub',
      'hub.hint': 'Use a DSH on a public server as the hub: other computers join with this URL and join token.',
      'hub.connectTitle': 'Connect to remote hub',
      'hub.connectHint': 'Enter the hub URL and join token once; status is pushed outbound, no public IP needed.',
      'hub.origin': 'Join URL',
      'hub.token': 'Join token',
      'hub.urlLabel': 'Hub URL',
      'hub.urlPlaceholder': 'https://dsh.example.com',
      'hub.tokenPlaceholder': 'Join token shown in the hub panel',
      'hub.connect': 'Connect',
      'hub.disconnect': 'Disconnect',
      'hub.connected': 'Connected',
      'hub.peers': 'Joined nodes',
      'hub.copyLink': 'Copy join link',
      'hub.linkCopied': 'Join link copied',
      'hub.qr': 'QR code',
      'hub.qrTitle': 'Scan to join',
      'hub.qrHint': 'Scan with a phone to open the hub page. The token lives only in the # fragment and is never sent to the server.',
      'hub.qrClose': 'Close',
      'hub.joinParsed': 'Filled address and token from the join link. Press Connect.',
      'hub.copyLinkFailed': 'Copy failed, select the link manually',
      'hub.showToken': 'Show token',
      'hub.hideToken': 'Hide',
      'hub.copy': 'Copy',
      'hub.copied': 'Copied',
      'hub.rotate': 'Regenerate',
      'hub.rotateConfirm': 'Regenerate? Connected computers must enter the new token.',
      'hub.rotated': 'Join token regenerated',
      'hub.failed': 'Connect failed',
      'event.hubLinked': 'Remote hub linked',
      'event.hubUnlinked': 'Remote hub disconnected',
      'event.hubPeerJoined': 'Remote node joined: {name}',
      'node.hubTag': 'Remote',
      'discovery.title': 'LAN discovery',
      'discovery.hint': 'Broadcasts name and address only — never the token. Joining requires the peer token.',
      'discovery.empty': 'No other DSH found on this LAN yet',
      'discovery.probe': 'Scan again',
      'discovery.join': 'Join',
      'discovery.added': 'Added',
      'discovery.prefillHint': 'Address filled in from discovery — paste the peer token.',
      'batch.all': 'Select visible',
      'batch.probe': 'Probe selected',
      'batch.enable': 'Enable selected',
      'batch.disable': 'Disable selected',
      'batch.clear': 'Clear selection',
      'toast.batchProbe': 'Probed {count} nodes',
      'toast.batchEnable': 'Enabled {count} nodes',
      'toast.batchDisable': 'Disabled {count} nodes',
      'event.batchProbed': 'Batch probe: {count} nodes',
      'event.batchEnabled': 'Batch enabled: {count} nodes',
      'event.batchDisabled': 'Batch disabled: {count} nodes',
      'filter.empty': 'No nodes match the filters',
      'control.title': 'Operations',
      'control.disabled': 'Operations are off on this node (set allowControl: true there and restart DSH).',
      'control.readOnlyHint': 'Nodes added by auto-discovery are read-only (only a read-only token is exchanged). Paste the full connection token in the node editor to enable remote operations.',
      'control.audit': 'Every action is appended to ~/.dsh/node-monitor/audit.jsonl on the node (0600, no token).',
      'control.plugins': 'Plugins',
      'control.load': 'Load plugins',
      'control.reload': 'Reload',
      'control.loading': 'Loading…',
      'control.empty': 'No controllable plugins',
      'control.enable': 'Enable',
      'control.disable': 'Disable',
      'control.readOnly': 'read-only',
      'control.confirmToggle': '{verb} {name}?',
      'control.confirm': 'Confirm',
      'control.cancel': 'Cancel',
      'control.restart': 'Restart node',
      'control.restartConfirm': 'The node will go offline briefly. Restart it?',
      'control.restarted': 'Restart requested',
      'control.failed': 'Failed to load plugins',
      'control.enabled': 'enabled',
      'control.disabledChip': 'disabled',
      'embed.actions': 'Embed',
      'embed.short': 'Embed',
      'embed.hint': 'Same-host nodes can be embedded; cross-host needs a same-site domain or open in a new tab.',
      'embed.crossSite': 'Cross-site nodes cannot be embedded (browser SameSite rules). Open in a new tab.',
      'embed.openTab': 'Open in tab',
      'embed.close': 'Close embed',
      'embed.loading': 'Opening node…',
      'embed.failed': 'Embed failed',
      'events.empty': 'No activity yet',
      'event.node.online': 'Node back online: {name}',
      'event.node.offline': 'Node offline: {name}',
      'event.node.degraded': 'Node probe failing: {name}',
      'event.node.unknown': 'Node state unknown: {name}',
      'event.nodeAdded': 'Node added: {name}',
      'event.nodeUpdated': 'Node updated: {name}',
      'event.nodePaired': 'Paired both ways: {name}',
      'event.nodeAutoPaired': 'Auto-paired: {name}',
      'event.loginSaved': 'Login material saved: {name}',
      'event.loginCleared': 'Login material cleared: {name}',
      'event.nodeRemoved': 'Node removed: {name}',
      'event.agentRunning': 'Agent started: {agent}',
      'event.agentIdle': 'Agent idle: {agent}',
      'event.agentCreated': 'Agent created: {agent}',
      'event.agentDisposed': 'Agent disposed: {agent}',
      'reason.auth': 'authentication failed (token missing, wrong or rotated)',
      'reason.timeout': 'probe timed out',
      'reason.unreachable': 'unreachable — check address, port and network',
      'reason.not-found': 'endpoint not found — is the monitor plugin enabled?',
      'reason.bad-json': 'response is not valid JSON',
      'reason.protocol': 'protocol version mismatch',
      'reason.remote-unhealthy': 'the node reports itself unhealthy',
      'reason.http-status': 'the node returned an error status',
      'error.generic': 'Failed: {message}',
      'error.crash': 'The panel hit a render error and was isolated. Refresh the page to retry.',
      'error.forbidden': 'You are not allowed to do this',
      'error.limit-reached': 'Node limit reached',
      'time.justNow': 'just now',
      'time.secondsAgo': '{n}s ago',
      'time.minutesAgo': '{n}m ago',
      'time.hoursAgo': '{n}h ago',
      'time.daysAgo': '{n}d ago',
      'uptime.text': '{d}d {h}h',
      'uptime.short': '{h}h {m}m',
      'footer.meta': 'protocol {protocol} · host {hostname}',
      'toast.opened': 'Opened in a new tab',
      'toast.openFailed': 'Open failed: {reason}',
      'toast.openFallback': 'Host build is older; opened the node base URL. Restart DSH for token-free open.',
      'toast.loginSaved': 'Login material saved',
      'toast.loginCleared': 'Login material cleared',
      'error.openUnavailable': 'This node cannot be opened',
      'error.login-url-invalid': 'Invalid login URL (http/https only)',
      'confirm.removeTitle': 'Remove node',
      'confirm.removeBody': 'Remove “{name}”? Only the local configuration is deleted; the remote node is untouched.',
      'confirm.remove': 'Remove',
      'loading': 'Loading…',
      'error.bad-json': 'Malformed response',
      'toast.saved': 'Saved',
      'toast.acked': 'Acknowledged',
      'toast.probed': 'Probe finished'
    }

    let localeReader = null
    function setDict() {
      // 保留调用点；t() 每次实时读取 locale，避免注册时机早于语言偏好恢复导致文案固定为英文。
    }
    function dictNow() {
      let active = ''
      try {
        active = String(localeReader?.getSnapshot?.()?.active ?? '')
      } catch (error) {
        active = ''
      }
      return active.toLowerCase().startsWith('zh') ? ZH : EN
    }
    function t(key, params) {
      const dict = dictNow()
      const template = dict[key] ?? (ZH[key] ?? key)
      if (!params) return template
      return template.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined || params[name] === null ? match : String(params[name])))
    }

    /* -------------------------------------------------------------- */
    /* 格式化                                                          */
    /* -------------------------------------------------------------- */

    function fmtBytes(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      let n = Math.max(0, value)
      let i = 0
      while (n >= 1024 && i < units.length - 1) {
        n /= 1024
        i += 1
      }
      return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`
    }

    function fmtPct(value) {
      return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 10) / 10}%` : '—'
    }

    function fmtMs(value) {
      return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)} ms` : '—'
    }

    function fmtUptime(sec) {
      if (typeof sec !== 'number' || !Number.isFinite(sec)) return '—'
      const days = Math.floor(sec / 86400)
      const hours = Math.floor((sec % 86400) / 3600)
      return days > 0 ? t('uptime.text', { d: days, h: hours }) : t('uptime.short', { h: hours, m: Math.floor((sec % 3600) / 60) })
    }

    function fmtRelative(iso) {
      if (!iso) return '—'
      const time = Date.parse(iso)
      if (!Number.isFinite(time)) return '—'
      const diff = Math.max(0, Date.now() - time)
      if (diff < 5000) return t('time.justNow')
      if (diff < 60000) return t('time.secondsAgo', { n: Math.floor(diff / 1000) })
      if (diff < 3600000) return t('time.minutesAgo', { n: Math.floor(diff / 60000) })
      if (diff < 86400000) return t('time.hoursAgo', { n: Math.floor(diff / 3600000) })
      return t('time.daysAgo', { n: Math.floor(diff / 86400000) })
    }

    function toneVar(status) {
      if (status === 'online') return 'var(--dsw-alias-state-success-primary)'
      if (status === 'degraded') return 'var(--dsw-alias-state-warn-primary)'
      if (status === 'offline') return 'var(--dsw-alias-state-error-primary)'
      return 'var(--dsw-alias-label-tertiary)'
    }

    function safeSvg(value) {
      const svg = typeof value === 'string' ? value.trim() : ''
      if (!/^<svg[\s>]/i.test(svg)) return ''
      if (/<script|on[a-z]+\s*=|javascript:/i.test(svg)) return ''
      return svg
    }

    function parseNodeLinkInput(value) {
      const raw = String(value || '').trim()
      const marker = '#node-monitor-add='
      const index = raw.indexOf(marker)
      if (index < 0) return null
      try {
        let b64 = raw.slice(index + marker.length).split('&')[0].replace(/-/g, '+').replace(/_/g, '/')
        while (b64.length % 4) b64 += '='
        const json = decodeURIComponent(Array.from(atob(b64), (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''))
        const data = JSON.parse(json)
        if (!data || data.v !== 1) return null
        if (typeof data.u !== 'string' || data.u.length > 300) return null
        let parsed
        try {
          parsed = new URL(data.u)
        } catch {
          return null
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
        if (!parsed.hostname) return null
        if (typeof data.t !== 'string' || data.t.length < 8 || data.t.length > 200) return null
        return { baseUrl: data.u, token: data.t }
      } catch {
        return null
      }
    }

    function parseJoinInput(value) {
      const raw = String(value || '').trim()
      if (!raw || raw.indexOf('#node-monitor-join=') < 0) return null
      try {
        const url = new URL(raw)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
        if (!url.hostname) return null
        const marker = '#node-monitor-join='
        if (!url.hash.startsWith(marker)) return null
        const token = decodeURIComponent(url.hash.slice(marker.length)).trim()
        if (token.length < 8 || token.length > 200) return null
        return { origin: `${url.origin}${url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')}`, token }
      } catch {
        return null
      }
    }

    async function copyText(text) {
      const value = String(text ?? '')
      if (!value) throw new Error('empty')
      if (navigator?.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(value)
          return
        } catch {
          /* 非安全上下文（http 局域网）会拒绝，退回 execCommand */
        }
      }
      const area = document.createElement('textarea')
      area.value = value
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.top = '-1000px'
      area.style.opacity = '0'
      document.body.appendChild(area)
      let ok = false
      try {
        area.select()
        ok = document.execCommand('copy')
      } finally {
        area.remove()
      }
      if (!ok) throw new Error('copy-failed')
    }

    function shortSession(id) {
      const text = String(id || '')
      return text.replace(/^session-/, '').slice(0, 10) || '—'
    }

    function baseName(value) {
      const parts = String(value || '').split(/[\\/]/).filter(Boolean)
      return parts.length > 0 ? parts[parts.length - 1] : ''
    }

    function reasonText(code) {
      if (!code) return ''
      const known = ['auth', 'timeout', 'unreachable', 'not-found', 'bad-json', 'protocol', 'remote-unhealthy', 'http-status']
      return known.includes(code) ? t(`reason.${code}`) : code
    }

    function alertText(alert) {
      const name = alert?.params?.name || ''
      const key = `alert.${alert?.code}`
      const text = dictNow()[key]
      if (text) return t(key, { name, ...(alert.params || {}) })
      if (typeof alert?.code === 'string' && alert.code.startsWith('node.remote.')) {
        return t('alert.node.remote', { name, code: alert.code.slice('node.remote.'.length) })
      }
      return `${alert?.code || 'alert'}${name ? ` · ${name}` : ''}`
    }

    function eventText(event) {
      if (!event) return ''
      const params = { ...(event.params || {}) }
      // Older hosts truncate agent ids to a bare "session-" prefix; show a placeholder until restart.
      if (params.agent === 'session-') params.agent = '—'
      const name = params.name || params.agent || ''
      const key = event.code
      if (key && dictNow()[key]) return t(key, { name, ...params })
      return event.text || key || ''
    }

    /* -------------------------------------------------------------- */
    /* Store                                                           */
    /* -------------------------------------------------------------- */

    const INITIAL = {
      phase: 'idle',
      data: null,
      error: null,
      view: 'overview',
      filter: { q: '', status: 'all', tag: 'all' },
    hubForm: { url: '', token: '' },
    hubReveal: false,
    hubToken: null,
    hubRotateConfirm: false,
    hubQr: null,
    invite: null,
    inviteQr: false,
      selected: [],
      control: null,
      controlPending: null,
      embed: null,
      selectedId: null,
      modal: null,
      selfToken: null,
      tokenConfirm: false,
      busy: false,
      toast: null,
      testResult: null
    }

    function createStore(ctx) {
      let state = { ...INITIAL }
      const listeners = new Set()
      let pollTimer = null
      let disposed = false
      let backoff = 0
      let toastTimer = null

      const get = () => state
      const subscribe = (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
      function set(patch) {
        state = { ...state, ...patch }
        for (const listener of listeners) {
          try {
            listener()
          } catch {
            /* ignore */
          }
        }
      }

      async function call(name, payload) {
        const result = await ctx.connection.rpc.call(RPC_CHANNEL, name, payload ?? {})
        if (!result || typeof result !== 'object') {
          const error = new Error('empty-response')
          error.code = 'bad-json'
          throw error
        }
        if (result.ok !== true) {
          const error = new Error(result.error?.message || 'request-failed')
          error.code = result.error?.code || 'internal'
          throw error
        }
        return result.value
      }

      function describeError(error) {
        const code = typeof error?.code === 'string' ? error.code.replace(/^node-monitor\//, '') : ''
        if (code === 'forbidden') return t('error.forbidden')
        if (code === 'limit-reached') return t('error.limit-reached')
        if (code === 'login-url-invalid') return t('error.login-url-invalid')
        return t('error.generic', { message: error?.message || code || 'unknown' })
      }

      function showToast(kind, text) {
        if (toastTimer) clearTimeout(toastTimer)
        set({ toast: { kind, text } })
        toastTimer = setTimeout(() => {
          if (!disposed) set({ toast: null })
        }, 4000)
      }

      function schedule(delay) {
        if (disposed) return
        if (pollTimer) clearTimeout(pollTimer)
        pollTimer = setTimeout(() => {
          if (disposed) return
          if (typeof document !== 'undefined' && document.hidden) {
            schedule(2500)
            return
          }
          load({ silent: true })
        }, Math.max(1000, Math.min(120000, delay)))
      }

      async function load(options = {}) {
        const silent = options.silent === true
        if (disposed) return
        if (!silent && !state.data) set({ phase: 'loading', error: null })
        try {
          const data = await call('state')
          backoff = 0
          set({ phase: 'ready', data, error: null })
          if (data?.hub?.enabled && state.hubToken === null) {
            call('hubInfo', {})
              .then((info) => set({ hubToken: info?.token || '' }))
              .catch(() => set({ hubToken: '' }))
          }
          schedule(data?.settings?.refreshMs ?? 5000)
        } catch (error) {
          backoff = backoff === 0 ? 2500 : Math.min(backoff * 2, 30000)
          set({ phase: state.data ? 'ready' : 'error', error: describeError(error) })
          schedule(backoff)
        }
      }

      async function mutate(name, payload, options = {}) {
        set({ busy: true })
        try {
          const data = await call(name, payload)
          const patch = { data, phase: 'ready', busy: false, error: null }
          if (options.closeModal) patch.modal = null
          if (options.view) patch.view = options.view
          if (options.selectedId !== undefined) patch.selectedId = options.selectedId
          set(patch)
          if (options.toast) showToast('ok', options.toast)
          schedule(data?.settings?.refreshMs ?? 5000)
          return data
        } catch (error) {
          set({ busy: false })
          showToast('error', describeError(error))
          throw error
        }
      }

      function hubReady() {
        const first = (state.data?.nodes || [])[0]
        return Boolean(first && 'login' in first)
      }

      const actions = {
        load,
        hubReady,
        refresh: async () => {
          set({ busy: true })
          try {
            const data = await call('refresh')
            set({ data, phase: 'ready', busy: false, error: null })
            showToast('ok', t('toast.probed'))
            schedule(data?.settings?.refreshMs ?? 5000)
          } catch (error) {
            set({ busy: false })
            showToast('error', describeError(error))
          }
        },
        openDetail: (id) => set({ view: 'detail', selectedId: id }),
        back: () => set({ view: 'overview', selectedId: null }),
        setFilter: (value) => set({ filter: { ...(state.filter || {}), ...value } }),
        clearFilter: () => set({ filter: { q: '', status: 'all', tag: 'all' } }),
        toggleSelect: (id) => {
          const selected = state.selected || []
          set({ selected: selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id] })
        },
        selectMany: (ids) => set({ selected: Array.from(new Set(ids)).slice(0, 64) }),
        clearSelection: () => set({ selected: [] }),
        batch: async (op) => {
          const ids = (get().selected || []).slice()
          if (ids.length === 0) return
          set({ busy: true })
          try {
            const data = await call('batchNodes', { op, ids })
            set({ busy: false, data, selected: [], toast: { kind: 'ok', text: t(op === 'probe' ? 'toast.batchProbe' : op === 'enable' ? 'toast.batchEnable' : 'toast.batchDisable', { count: ids.length }) } })
          } catch (error) {
            set({ busy: false, toast: { kind: 'error', text: t('error.generic') + '：' + codeOf(error) } })
          }
        },
        openModal: (modal) => set({ modal, testResult: null }),
        revealToken: async () => {
          try {
            const info = await call('selfToken')
            set({ selfToken: info })
          } catch (error) {
            showToast('error', describeError(error))
          }
        },
        hideToken: () => set({ selfToken: null }),
        copyToken: async (text) => {
          try {
            await copyText(text)
            showToast('ok', t('self.copied'))
          } catch {
            showToast('error', t('self.copyFailed'))
          }
        },
        updateLabel: async (label) => {
          try {
            const data = await call('updateLabel', { label })
            set({ data })
            showToast('ok', t('self.renamed'))
          } catch (error) {
            showToast('error', describeError(error))
          }
        },
        setHubForm: (patchValue) => set({ hubForm: { ...state.hubForm, ...patchValue } }),
        hubReveal: () => set({ hubReveal: true }),
        hubHide: () => set({ hubReveal: false }),
        hubCopy: async (value) => {
          try {
            await copyText(value)
            showToast('ok', t('hub.copied'))
          } catch {
            showToast('error', t('copyFailed'))
          }
        },
        hubCopyLink: async () => {
          try {
            const info = await call('hubJoin', {})
            await copyText(info.link)
            showToast('ok', t('hub.linkCopied'))
          } catch (error) {
            showToast('error', describeError(error))
          }
        },
        hubQrStart: async () => {
          try {
            const info = await call('hubJoin', {})
            set({ hubQr: info })
          } catch (error) {
            showToast('error', describeError(error))
          }
        },
        hubQrClose: () => set({ hubQr: null }),
        inviteOpen: async () => {
          try {
            const invite = await call('nodeInvite', {})
            set({ invite, inviteQr: false })
          } catch (error) {
            showToast('error', describeError(error))
          }
        },
        invitePick: async (address) => {
          try {
            const invite = await call('nodeInvite', { address })
            set({ invite })
          } catch (error) {
            showToast('error', describeError(error))
          }
        },
        inviteCopy: async () => {
          try {
            const invite = st.invite || await call('nodeInvite', {})
            await copyText(invite.link)
            set({ invite })
            showToast('ok', t('invite.copied'))
          } catch (error) {
            showToast('error', describeError(error))
          }
        },
        inviteQrOpen: () => set({ inviteQr: true }),
        inviteQrClose: () => set({ inviteQr: false }),
        inviteClose: () => set({ invite: null, inviteQr: false }),
        notifyNodeLinkParsed: () => showToast('ok', t('modal.linkParsed')),
        notifyJoinParsed: () => showToast('ok', t('hub.joinParsed')),
        hubConnect: async () => {
          const url = String(state.hubForm?.url || '').trim()
          const token = String(state.hubForm?.token || '').trim()
          if (!url || !token) return
          set({ busy: true })
          try {
            const data = await call('hubConnect', { url, token })
            set({ data, busy: false, hubForm: { url: '', token: '' } })
            call('hubInfo', {})
              .then((info) => set({ hubToken: info?.token || '' }))
              .catch(() => {})
            showToast('ok', t('hub.connected'))
          } catch (error) {
            set({ busy: false })
            showToast('error', describeError(error))
          }
        },
        hubDisconnect: async () => {
          set({ busy: true })
          try {
            const data = await call('hubDisconnect', {})
            set({ data, busy: false })
            showToast('warn', t('hub.disconnect'))
          } catch (error) {
            set({ busy: false })
            showToast('error', describeError(error))
          }
        },
        hubRotateStart: () => set({ hubRotateConfirm: true }),
        hubRotateCancel: () => set({ hubRotateConfirm: false }),
        hubRotate: async () => {
          try {
            const value = await call('hubRotateToken', { confirm: true })
            const data = await call('state', {})
            set({ data, hubToken: value?.token || '', hubRotateConfirm: false, hubReveal: true })
            showToast('ok', t('hub.rotated'))
          } catch (error) {
            showToast('error', describeError(error))
          }
        },
        rotateTokenStart: () => set({ tokenConfirm: true }),
        rotateTokenCancel: () => set({ tokenConfirm: false }),
        rotateToken: async () => {
          try {
            const info = await call('rotateToken', { confirm: true })
            set({ selfToken: info, tokenConfirm: false })
            showToast('ok', t('self.rotated'))
          } catch (error) {
            showToast('error', describeError(error))
          }
        },
        useDiscovered: (entry) =>
          set({
            modal: { type: 'add', prefill: { name: entry.label || '', baseUrl: entry.address || '' } },
            testResult: null
          }),
        refreshDiscovery: async () => {
          try {
            const data = await call('discoveryProbe')
            set({ data })
          } catch (error) {
            showToast('error', describeError(error))
          }
        },
        controlList: async (nodeId) => {
          set({ control: { nodeId, loading: true, items: [], error: '', disabled: false } })
          try {
            const result = await call('control', { id: nodeId, action: 'plugins.list', dryRun: false })
            const response = result?.response || {}
            if (response.ok !== true) {
              const disabled = response.error === 'control-disabled'
              set({ control: { nodeId, loading: false, items: [], error: disabled ? '' : response.error || 'failed', disabled } })
              return
            }
            set({ control: { nodeId, loading: false, items: response.value?.items || [], error: '', disabled: false } })
          } catch (error) {
            const code = typeof error?.code === 'string' ? error.code.replace(/^node-monitor\//, '') : ''
            set({ control: { nodeId, loading: false, items: [], error: code || 'failed', disabled: code === 'control-disabled' } })
          }
        },
        controlToggle: async (nodeId, plugin, confirmed) => {
          if (!confirmed) {
            set({ controlPending: { kind: 'toggle', nodeId, id: plugin.id, name: plugin.name, enabled: !plugin.enabled } })
            return
          }
          const pending = state.controlPending
          set({ controlPending: null })
          try {
            const result = await call('control', {
              id: nodeId,
              action: 'plugins.setEnabled',
              params: { id: pending?.id || plugin.id, enabled: pending?.enabled ?? !plugin.enabled },
              dryRun: false,
              confirm: true
            })
            const response = result?.response || {}
            if (response.ok !== true) throw Object.assign(new Error(response.error || 'failed'), { code: response.error })
            showToast('ok', t('toast.saved'))
            await state.actions.controlList(nodeId)
          } catch (error) {
            showToast('error', describeError(error))
          }
        },
        controlRestart: async (nodeId, confirmed) => {
          if (!confirmed) {
            set({ controlPending: { kind: 'restart', nodeId } })
            return
          }
          set({ controlPending: null })
          try {
            const result = await call('control', { id: nodeId, action: 'restart', dryRun: false, confirm: true })
            const response = result?.response || {}
            if (response.ok !== true) throw Object.assign(new Error(response.error || 'failed'), { code: response.error })
            showToast('ok', t('control.restarted'))
          } catch (error) {
            showToast('error', describeError(error))
          }
        },
        controlCancel: () => set({ controlPending: null }),
        embedNode: async (nodeOrId) => {
          const node = typeof nodeOrId === 'string'
            ? (state.data?.nodes || []).find((item) => item.id === nodeOrId)
            : nodeOrId
          if (!node) return
          let hostname = ''
          try {
            hostname = new URL(node.baseUrl).hostname
          } catch {
            hostname = ''
          }
          const sameSite = hostname === window.location.hostname
          if (!sameSite) {
            showToast('error', t('embed.crossSite'))
            return
          }
          set({ embed: { nodeId: node.id, name: node.name, url: '', loading: true, error: '' } })
          try {
            const ticket = await call('openTicket', { id: node.id })
            set({ embed: { nodeId: node.id, name: node.name, url: ticket?.url || node.baseUrl, loading: false, error: '' } })
          } catch (error) {
            set({ embed: { nodeId: node.id, name: node.name, url: node.baseUrl, loading: false, error: describeError(error) } })
          }
        },
        closeEmbed: () => set({ embed: null }),
        closeModal: () => set({ modal: null, testResult: null }),
        addNode: (payload) =>
          mutate('addNode', payload, { closeModal: true, toast: t('toast.saved') }),
        updateNode: (payload) =>
          mutate('updateNode', payload, { closeModal: true, toast: t('toast.saved') }),
        removeNode: (id) =>
          mutate('removeNode', { id }, { closeModal: true, view: 'overview', selectedId: null, toast: t('toast.saved') }),
        ackAlert: (key) => mutate('ackAlert', { key }, { toast: t('toast.acked') }),
        ackAll: () => mutate('ackAll', {}, { toast: t('toast.acked') }),
        saveSettings: (payload) => mutate('settings', payload, { closeModal: true, toast: t('toast.saved') }),
        probeNode: async (id) => {
          set({ busy: true })
          try {
            await call('refresh')
            await load({ silent: true })
            set({ busy: false })
            showToast('ok', t('toast.probed'))
          } catch (error) {
            set({ busy: false })
            showToast('error', describeError(error))
          }
        },
        openNode: async (id) => {
          if (!hubReady()) {
            const fallback = (state.data?.nodes || []).find((item) => item.id === id)
            if (fallback?.baseUrl) {
              window.open(fallback.baseUrl, '_blank', 'noopener')
              showToast('error', t('toast.openFallback'))
            }
            return
          }
          // 先同步打开一个空白标签页，避免 await 之后被浏览器当作弹窗拦截。
          let win = null
          try {
            win = window.open('about:blank', '_blank')
          } catch {
            win = null
          }
          try {
            const ticket = await call('openTicket', { id })
            const url = ticket?.url
            if (!url) throw new Error(t('error.openUnavailable'))
            if (win) {
              try {
                win.opener = null
              } catch {
                /* ignore */
              }
              win.location.replace(url)
            } else {
              window.open(url, '_blank', 'noopener')
            }
            showToast('ok', t('toast.opened'))
          } catch (error) {
            if (win) {
              try {
                win.close()
              } catch {
                /* ignore */
              }
            }
            // 兼容尚未重载的旧宿主：退化为直接打开节点地址（仍可手动粘贴令牌）。
            const currentNode = (state.data?.nodes || []).find((item) => item.id === id)
            if (currentNode?.baseUrl) {
              try {
                window.open(currentNode.baseUrl, '_blank', 'noopener')
                showToast('error', t('toast.openFallback'))
                return
              } catch {
                /* ignore */
              }
            }
            showToast('error', describeError(error))
          }
        },
        setLogin: (id, url) => mutate('setLogin', { id, url }, { toast: t('toast.loginSaved') }),
        clearLogin: (id) => mutate('clearLogin', { id }, { toast: t('toast.loginCleared') }),
        testNode: async (payload) => {
          set({ busy: true, testResult: null })
          try {
            const result = await call('testNode', payload)
            set({ busy: false, testResult: result })
            return result
          } catch (error) {
            set({ busy: false })
            showToast('error', describeError(error))
            throw error
          }
        }
      }

      function dispose() {
        disposed = true
        if (pollTimer) clearTimeout(pollTimer)
        if (toastTimer) clearTimeout(toastTimer)
        pollTimer = null
      }

      try {
        const invited = parseJoinInput(window.location.href)
        if (invited) {
          set({ hubForm: { url: invited.origin, token: invited.token } })
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
        }
      } catch (error) {
        // ignore malformed join links
      }

      load()

      return { get, subscribe, actions, dispose, describeError }
    }

    let store = null

    function useStore(current) {
      const [, force] = useState(0)
      useEffect(() => {
        if (!current) return undefined
        return current.subscribe(() => force((value) => value + 1))
      }, [current])
      return current ? current.get() : INITIAL
    }

    function useLocaleTick(ctx) {
      const [, force] = useState(0)
      useEffect(() => {
        let off
        try {
          const snapshot = ctx.locale?.getSnapshot?.() || {}
          setDict(snapshot.active)
          off = ctx.locale?.subscribe?.(() => {
            const next = ctx.locale.getSnapshot?.() || {}
            setDict(next.active)
            force((value) => value + 1)
          })
        } catch {
          /* ignore */
        }
        return () => {
          if (typeof off === 'function') off()
        }
      }, [ctx])
    }

    /* -------------------------------------------------------------- */
    /* 基础组件                                                        */
    /* -------------------------------------------------------------- */

    function StatusDot({ status }) {
      return h('span', { className: `nm-dot nm-dot--${status || 'unknown'}`, 'aria-hidden': 'true' })
    }

    function StatusPill({ status }) {
      return h('span', { className: `nm-pill nm-pill--${status || 'unknown'}` }, [
        h(StatusDot, { key: 'dot', status }),
        h('span', { key: 'text' }, t(`status.${status || 'unknown'}`))
      ])
    }

    function MetricBar({ label, value, tone, reverse }) {
      const pct = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null
      const color = tone || (pct === null ? 'var(--dsw-alias-label-tertiary)' : pct >= 90 ? 'var(--dsw-alias-state-error-primary)' : pct >= 75 ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-brand-primary)')
      return h('div', { className: 'nm-metric' }, [
        h('div', { key: 'head', className: 'nm-metric-head' }, [
          h('span', { key: 'label' }, label),
          h('span', { key: 'value', className: 'nm-metric-value' }, pct === null ? '—' : `${Math.round(pct * 10) / 10}%`)
        ]),
        h('div', { key: 'track', className: 'nm-metric-track', role: 'img', 'aria-label': `${label} ${pct === null ? '—' : `${pct}%`}` }, [
          h('div', {
            key: 'fill',
            className: `nm-metric-fill${reverse ? ' nm-metric-fill--reverse' : ''}`,
            style: { width: `${pct ?? 0}%`, background: color }
          })
        ])
      ])
    }

    function Spinner() {
      return h('span', { className: 'nm-spinner', 'aria-label': t('loading') })
    }

    function Chip({ children, tone }) {
      return h('span', { className: `nm-chip${tone ? ` nm-chip--${tone}` : ''}` }, children)
    }

    /* -------------------------------------------------------------- */
    /* 侧栏图标                                                        */
    /* -------------------------------------------------------------- */

    function MonitorIcon(props) {
      const st = useStore(store)
      const size = props?.size || 18
      const active = props?.active === true
      const summary = st.data?.summary
      let tone = 'var(--dsw-alias-label-tertiary)'
      if (summary) {
        if (summary.alertsCritical > 0 || summary.offline > 0) tone = 'var(--dsw-alias-state-error-primary)'
        else if (summary.alertsOpen > 0 || summary.degraded > 0) tone = 'var(--dsw-alias-state-warn-primary)'
        else if (summary.online > 0) tone = 'var(--dsw-alias-state-success-primary)'
      }
      const stroke = active ? 'var(--dsw-alias-label-primary)' : 'currentColor'
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke,
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false'
        },
        [
          h('rect', { key: 'screen', x: 2.75, y: 4.25, width: 12.5, height: 9, rx: 1.6 }),
          h('path', { key: 'stand', d: 'M6 19.75h6M9.5 13.25v6.5', strokeWidth: 1.6 }),
          h('circle', { key: 'badge', cx: 17.9, cy: 6.9, r: 2.35, fill: tone, stroke: 'none' }),
          h('path', { key: 'net', d: 'M13.9 12.1c.65-1.15 2.1-1.85 4-1.85s3.35.7 4 1.85' })
        ]
      )
    }

    /* -------------------------------------------------------------- */
    /* 总览                                                            */
    /* -------------------------------------------------------------- */

    function AlertRow({ alert, onAck, onOpen }) {
      const meta = []
      meta.push(h('span', { key: 'time' }, fmtRelative(alert.since)))
      if (alert.acked) meta.push(h('span', { key: 'acked', className: 'nm-muted' }, t('alerts.acked')))
      const reason = alert.params?.reason
      return h('li', { className: `nm-alert nm-alert--${alert.severity}` }, [
        h('span', { key: 'dot', className: 'nm-alert-dot' }),
        h('div', { key: 'body', className: 'nm-alert-body' }, [
          h('div', { key: 'title', className: 'nm-alert-title' }, alertText(alert)),
          h('div', { key: 'meta', className: 'nm-alert-meta' }, [
            ...meta,
            reason ? h('span', { key: 'reason' }, reasonText(reason)) : null,
            alert.params?.value !== undefined ? h('span', { key: 'value' }, t('alert.value', { value: alert.params.value })) : null
          ])
        ]),
        [
          onOpen && !alert.acked
            ? h('button', { key: 'open', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: () => onOpen(alert) }, t('actions.openNode'))
            : null,
          onAck && !alert.acked
            ? h('button', { key: 'ack', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: () => onAck(alert.key) }, t('actions.ack'))
            : null
        ].filter(Boolean)
      ])
    }

    function NodeCard({ node, probe, alertCount, selected, onSelect, onOpen, onEdit, onOpenRemote, onEmbed }) {
      const status = probe?.status || 'unknown'
      const autoNode =
        node.adapter === 'hub' || (Array.isArray(node.tags) && node.tags.includes('auto'))
      const snapshot = probe?.snapshot
      const metrics = snapshot?.metrics || {}
      const sessions = snapshot?.sessions || {}
      return h(
        'article',
        {
          className: `nm-card nm-card--${status}`,
          onClick: onOpen,
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onOpen()
            }
          },
          role: 'button',
          tabIndex: 0
        },
        [
          h('div', { key: 'head', className: 'nm-card-head' }, [
            h('input', {
              key: 'pick',
              type: 'checkbox',
              className: 'nm-card-pick',
              checked: Boolean(selected),
              'aria-label': t('batch.selected', { count: 1 }),
              title: t('batch.selected', { count: 1 }),
              onClick: (event) => event.stopPropagation(),
              onChange: (event) => {
                event.stopPropagation()
                onSelect()
              }
            }),
            h(StatusDot, { key: 'dot', status }),
            h('div', { key: 'title', className: 'nm-card-title' }, [
              h('div', { key: 'name', className: 'nm-card-name' }, node.name),
              h('div', { key: 'url', className: 'nm-card-url' }, node.baseUrl)
            ]),
            node.tags?.includes('self') ? h('span', { key: 'self', className: 'nm-tag' }, t('node.self')) : null,
            (node.tags || [])
              .filter((tag) => tag !== 'self')
              .slice(0, 2)
              .map((tag) =>
                h(
                  'span',
                  { key: `tag-${tag}`, className: 'nm-tag nm-tag--group' },
                  tag === 'hub'
                    ? t('node.hubTag')
                    : tag === 'paired' || tag === 'auto'
                      ? t(tag === 'auto' ? 'node.autoTag' : 'node.pairedTag')
                      : tag
                )
              ),
            h(
              'button',
              {
                key: 'openRemote',
                className: 'nm-card-open',
                title: t('node.openHint'),
                'aria-label': t('node.open'),
                style: autoNode ? { display: 'none' } : null,
                onClick: (event) => {
                  event.stopPropagation()
                  onOpenRemote()
                }
              },
              `${t('actions.open')} ↗`
            ),
            h(
              'button',
              {
                key: 'embed',
                className: 'nm-card-open',
                title: t('embed.hint'),
                'aria-label': t('embed.actions'),
                style: autoNode ? { display: 'none' } : null,
                onClick: (event) => {
                  event.stopPropagation()
                  onEmbed()
                }
              },
              t('embed.short')
            ),
            h(
              'button',
              {
                key: 'edit',
                className: 'nm-icon-btn',
                title: t('actions.edit'),
                'aria-label': t('actions.edit'),
                onClick: (event) => {
                  event.stopPropagation()
                  onEdit()
                }
              },
              '⋯'
            )
          ]),
          h('div', { key: 'meta', className: 'nm-card-meta' }, [
            h('span', { key: 'adapter' }, node.adapter === 'generic' ? t('adapter.generic') : t('adapter.dsh')),
            h('span', { key: 'net' }, t(`network.${node.network || 'lan'}`)),
            node.adapter === 'hub'
              ? h('span', { key: 'login', className: 'nm-muted' }, t('node.hubTag'))
              : h(
                  'span',
                  { key: 'login', className: node.login?.configured ? 'nm-card-login' : 'nm-muted' },
                  node.login?.configured ? `${t('login.configured')} · ${node.login.host}` : t('login.missing')
                ),
            probe?.latencyMs !== undefined && probe?.latencyMs !== null ? h('span', { key: 'lat' }, `${t('node.latency')} ${fmtMs(probe.latencyMs)}`) : null,
            h('span', { key: 'seen' }, `${t('node.lastSeen')} ${fmtRelative(probe?.lastSeenAt)}`)
          ]),
          h(MetricBar, { key: 'cpu', label: t('node.cpu'), value: metrics.cpuPct }),
          h(MetricBar, { key: 'mem', label: t('node.mem'), value: metrics.memPct }),
          h(MetricBar, {
            key: 'disk',
            label: t('node.diskFree'),
            value: metrics.diskFreePct,
            tone: metrics.diskFreePct !== null && metrics.diskFreePct <= 10 ? 'var(--dsw-alias-state-error-primary)' : undefined
          }),
          h('div', { key: 'foot', className: 'nm-card-foot' }, [
            h('span', { key: 'sessions' }, `${t('node.sessions')} ${sessions.total ?? '—'} · ${t('node.sessionRunning')} ${sessions.running ?? '—'}`),
            alertCount > 0 ? h('span', { key: 'alerts', className: 'nm-card-alert' }, `${t('alerts.title')} ${alertCount}`) : null,
            probe?.error ? h('span', { key: 'error', className: 'nm-card-error', title: probe.error.message }, reasonText(probe.error.code)) : null
          ])
        ]
      )
    }

    function EmptyState({ onAdd }) {
      return h('div', { className: 'nm-empty' }, [
        h('div', { key: 'icon', className: 'nm-empty-icon' }, '◫'),
        h('h3', { key: 'title' }, t('empty.title')),
        h('p', { key: 'desc' }, t('empty.desc')),
        h('button', { key: 'add', className: 'nm-btn', onClick: onAdd }, t('empty.add'))
      ])
    }

    function SelfPanel({ st, actions }) {
      const info = st.data?.self || {}
      const [renaming, setRenaming] = useState(false)
      const [draft, setDraft] = useState('')
      const revealed = st.selfToken && st.selfToken.token
      const tokenText = revealed ? st.selfToken.token : '••••-••••-••••'
      return h('section', { className: 'nm-section nm-self' }, [
        h('div', { key: 'head', className: 'nm-section-head' }, [
          h('h3', { key: 'title' }, t('self.title')),
          h(
            'div',
            { key: 'actions', className: 'nm-self-actions' },
            revealed
              ? [h('button', { key: 'copy', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: () => actions.copyToken(tokenText) }, t('self.copy')),
                 h('button', { key: 'hide', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: actions.hideToken }, t('self.hide'))]
              : [h('button', { key: 'show', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: actions.revealToken }, t('self.reveal'))]
          )
        ]),
        h('p', { key: 'hint', className: 'nm-hint' }, t('self.hint')),
        h('div', { key: 'grid', className: 'nm-self-grid' }, [
          h('div', { key: 'id', className: 'nm-self-row' }, [
            h('span', { className: 'nm-self-label' }, t('self.id')),
            h('code', { className: 'nm-self-value' }, info.shortId || '—')
          ]),
          h('div', { key: 'label', className: 'nm-self-row' }, [
            h('span', { className: 'nm-self-label' }, t('self.label')),
            renaming
              ? h('span', { className: 'nm-inline-actions' }, [
                  h('input', {
                    key: 'input',
                    className: 'nm-input nm-self-input',
                    value: draft,
                    maxLength: 40,
                    onChange: (event) => setDraft(event.target.value)
                  }),
                  h('button', {
                    key: 'save',
                    className: 'nm-btn nm-btn--primary nm-btn--sm',
                    onClick: async () => {
                      await actions.updateLabel(draft.trim())
                      setRenaming(false)
                    }
                  }, t('self.save')),
                  h('button', { key: 'cancel', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: () => setRenaming(false) }, t('self.cancel'))
                ])
              : [h('span', { key: 'value', className: 'nm-self-value' }, info.label || '—'),
                 h('button', { key: 'rename', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: () => { setDraft(info.label || ''); setRenaming(true) } }, t('self.rename'))]
          ]),
          h('div', { key: 'token', className: 'nm-self-row nm-self-row--token' }, [
            h('span', { className: 'nm-self-label' }, t('self.token')),
            h('code', { className: 'nm-self-token' + (revealed ? '' : ' nm-self-token--hidden') }, tokenText),
            st.tokenConfirm
              ? h('span', { className: 'nm-inline-actions' }, [
                  h('button', { key: 'ok', className: 'nm-btn nm-btn--danger nm-btn--sm', onClick: actions.rotateToken }, t('self.confirm')),
                  h('button', { key: 'no', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: actions.rotateTokenCancel }, t('self.cancel'))
                ])
              : h('button', { key: 'rotate', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: actions.rotateTokenStart }, t('self.rotate'))
          ])
        ]),
        h('div', { key: 'inviteRow', className: 'nm-inline-actions nm-self-invite' }, [
          h('button', { key: 'open', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: actions.inviteOpen }, t('self.invite'))
        ]),
        st.invite
          ? h('div', { key: 'invite', className: 'nm-invite' }, [
              h('div', { key: 'head', className: 'nm-invite-head' }, [
                h('strong', { key: 't' }, t('invite.title')),
                h('button', { key: 'close', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: actions.inviteClose }, t('invite.close'))
              ]),
              h('p', { key: 'hint', className: 'nm-hint' }, t('invite.hint')),
              h('p', { key: 'warn', className: 'nm-hint' }, t('invite.warn')),
              h('div', { key: 'addr', className: 'nm-self-row' }, [
                h('span', { className: 'nm-self-label' }, t('invite.address')),
                h('select', {
                  key: 'select',
                  className: 'nm-input nm-invite-select',
                  value: st.invite.address,
                  onChange: (event) => actions.invitePick(event.target.value)
                }, (st.invite.addresses || []).map((item) => h('option', { key: item.url, value: item.url }, item.url)))
              ]),
              h('div', { key: 'actions', className: 'nm-inline-actions' }, [
                h('button', { key: 'copy', className: 'nm-btn nm-btn--primary nm-btn--sm', onClick: actions.inviteCopy }, t('invite.copy')),
                h('button', { key: 'qr', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: actions.inviteQrOpen }, t('invite.qr'))
              ]),
              h('code', { key: 'link', className: 'nm-qr-link' }, st.invite.link || ''),
              st.inviteQr
                ? h('div', { key: 'qrbox', className: 'nm-qr' }, [
                    h('div', { key: 'qrhead', className: 'nm-qr-head' }, [
                      h('strong', { key: 'qrt' }, t('invite.qr')),
                      h('button', { key: 'qrx', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: actions.inviteQrClose }, t('invite.qrClose'))
                    ]),
                    h('div', { key: 'svg', className: 'nm-qr-svg', dangerouslySetInnerHTML: { __html: safeSvg(st.invite.svg) } })
                  ])
                : null
            ])
          : null
      ])
    }


    function HubPanel({ st, actions }) {
      const hub = st.data?.hub || {}
      const link = hub.link
      const form = st.hubForm || { url: '', token: '' }
      const revealed = Boolean(st.hubReveal)
      const tokenText = st.hubToken ? (revealed ? st.hubToken : '••••-••••-••••') : '—'
      const rows = []
      rows.push(h('p', { key: 'hint', className: 'nm-hint' }, t('hub.hint')))
      if (link) {
        rows.push(h('div', { key: 'linked', className: 'nm-self-row' }, [
          h('span', { className: 'nm-self-label' }, t('hub.connected')),
          h('code', { className: 'nm-self-value' }, link.url),
          h('button', { className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: actions.hubDisconnect }, t('hub.disconnect'))
        ]))
      } else {
        rows.push(h('div', { key: 'form', className: 'nm-hub-form' }, [
          h('input', {
            key: 'url',
            className: 'nm-input',
            value: form.url,
            placeholder: t('hub.urlPlaceholder'),
            'aria-label': t('hub.urlLabel'),
            onChange: (event) => {
              const value = event.target.value
              const parsed = parseJoinInput(value)
              if (parsed) {
                actions.setHubForm({ url: parsed.origin, token: parsed.token })
                actions.notifyJoinParsed()
              } else {
                actions.setHubForm({ url: value })
              }
            }
          }),
          h('input', {
            key: 'token',
            className: 'nm-input',
            type: 'password',
            value: form.token,
            placeholder: t('hub.tokenPlaceholder'),
            'aria-label': t('hub.token'),
            onChange: (event) => actions.setHubForm({ token: event.target.value })
          }),
          h('button', { key: 'connect', className: 'nm-btn nm-btn--primary', disabled: st.busy || !form.url || !form.token, onClick: actions.hubConnect }, t('hub.connect'))
        ]))
        rows.push(h('p', { key: 'connectHint', className: 'nm-hint' }, t('hub.connectHint')))
      }
      if (hub.enabled) {
        rows.push(h('div', { key: 'origin', className: 'nm-self-row' }, [
          h('span', { className: 'nm-self-label' }, t('hub.origin')),
          h('code', { className: 'nm-self-value' }, hub.origin || '—'),
          h('button', { className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: () => actions.hubCopy(hub.origin || '') }, t('hub.copy'))
        ]))
        rows.push(h('div', { key: 'token', className: 'nm-self-row nm-self-row--token' }, [
          h('span', { className: 'nm-self-label' }, t('hub.token')),
          h('code', { className: 'nm-self-token' + (revealed ? '' : ' nm-self-token--hidden') }, tokenText),
          h('span', { key: 'actions', className: 'nm-inline-actions' }, [
            revealed
              ? h('button', { key: 'hide', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: actions.hubHide }, t('hub.hideToken'))
              : h('button', { key: 'show', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: actions.hubReveal }, t('hub.showToken')),
            h('button', { key: 'copy', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: () => actions.hubCopy(st.hubToken || '') }, t('hub.copy')),
            st.hubRotateConfirm
              ? h('span', { key: 'confirm', className: 'nm-inline-actions' }, [
                  h('button', { key: 'ok', className: 'nm-btn nm-btn--danger nm-btn--sm', onClick: actions.hubRotate }, t('hub.rotateConfirm')),
                  h('button', { key: 'no', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: actions.hubRotateCancel }, t('self.cancel'))
                ])
              : h('button', { key: 'rotate', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: actions.hubRotateStart }, t('hub.rotate'))
          ])
        ]))
        rows.push(h('div', { key: 'peers', className: 'nm-self-row' }, [
          h('span', { className: 'nm-self-label' }, t('hub.peers')),
          h('span', { className: 'nm-self-value' }, String(hub.peers || 0))
        ]))
        rows.push(h('div', { key: 'share', className: 'nm-inline-actions nm-hub-share' }, [
          h('button', { key: 'link', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: actions.hubCopyLink }, t('hub.copyLink')),
          h('button', { key: 'qr', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: actions.hubQrStart }, t('hub.qr'))
        ]))
      }
      if (st.hubQr) {
        rows.push(h('div', { key: 'qr', className: 'nm-qr' }, [
          h('div', { key: 'head', className: 'nm-qr-head' }, [
            h('strong', { key: 't' }, t('hub.qrTitle')),
            h('button', { key: 'x', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: actions.hubQrClose }, t('hub.qrClose'))
          ]),
          h('div', { key: 'svg', className: 'nm-qr-svg', dangerouslySetInnerHTML: { __html: safeSvg(st.hubQr.svg) } }),
          h('code', { key: 'link', className: 'nm-qr-link' }, st.hubQr.link || ''),
          h('p', { key: 'hint', className: 'nm-hint' }, t('hub.qrHint'))
        ]))
      }
      return h('section', { className: 'nm-section nm-self nm-hub' }, [
        h('div', { key: 'head', className: 'nm-section-head' }, [h('h3', { key: 'title' }, t('hub.title'))]),
        ...rows
      ])
    }

    function DiscoveryPanel({ st, actions }) {
      const discovery = st.data?.discovery
      if (!discovery) return null
      const items = discovery.nodes || []
      return h('section', { className: 'nm-section nm-discovery' }, [
        h('div', { key: 'head', className: 'nm-section-head' }, [
          h('h3', { key: 'title' }, t('discovery.title') + (items.length ? ` · ${items.length}` : '')),
          h('button', { key: 'probe', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: actions.refreshDiscovery }, t('discovery.probe'))
        ]),
        h('p', { key: 'hint', className: 'nm-hint' }, t('discovery.hint')),
        items.length === 0
          ? h('p', { key: 'empty', className: 'nm-empty-inline' }, t('discovery.empty'))
          : h('ul', { key: 'list', className: 'nm-discovery-list' }, items.map((entry) =>
              h('li', { key: entry.id, className: 'nm-discovery-item' }, [
                h('div', { key: 'main', className: 'nm-discovery-main' }, [
                  h('strong', { key: 'name' }, entry.label || entry.hostname || 'DSH'),
                  h('span', { key: 'addr', className: 'nm-muted' }, entry.address),
                  h('span', { key: 'meta', className: 'nm-muted nm-discovery-meta' }, `${t('self.id')} ${entry.shortId}${entry.version ? ` · v${entry.version}` : ''}`)
                ]),
                entry.added
                  ? h('span', { key: 'added', className: 'nm-chip' }, t('discovery.added'))
                  : h('button', { key: 'join', className: 'nm-btn nm-btn--primary nm-btn--sm', onClick: () => actions.useDiscovered(entry) }, t('discovery.join'))
              ])
            ))
      ])
    }

    function Overview({ st, actions }) {
      const data = st.data
      const nodes = data?.nodes || []
      const probes = data?.probes || {}
      const alerts = data?.alerts || []
      const openAlerts = alerts.filter((alert) => !alert.acked)
      const alertCounts = {}
      for (const alert of alerts) alertCounts[alert.nodeId] = (alertCounts[alert.nodeId] || 0) + (alert.acked ? 0 : 1)
      const events = data?.events || []
      const filter = st.filter || { q: '', status: 'all', tag: 'all' }
      const allTags = Array.from(new Set(nodes.flatMap((node) => (node.tags || []).filter((tag) => tag !== 'self'))))
      const keyword = String(filter.q || '').trim().toLowerCase()
      const selectedIds = st.selected || []
      const filtered = nodes.filter((node) => {
        const probe = probes[node.id] || {}
        const status = probe.status || 'unknown'
        if (filter.status !== 'all' && status !== filter.status) return false
        if (filter.tag !== 'all' && !(node.tags || []).includes(filter.tag)) return false
        if (!keyword) return true
        return `${node.name} ${node.baseUrl}`.toLowerCase().includes(keyword)
      })
      const visibleIds = filtered.map((node) => node.id)

      if (nodes.length === 0) return h(EmptyState, { onAdd: () => actions.openModal({ type: 'add' }) })

      return h('div', { className: 'nm-body' }, [
        openAlerts.length > 0
          ? h('section', { key: 'alerts', className: 'nm-section nm-section--alerts' }, [
              h('div', { key: 'head', className: 'nm-section-head' }, [
                h('h3', { key: 'title' }, t('alerts.title')),
                h('button', { key: 'all', className: 'nm-btn nm-btn--ghost', onClick: actions.ackAll }, t('actions.ackAll'))
              ]),
              h('ul', { key: 'list', className: 'nm-alert-list' }, openAlerts.map((alert) => h(AlertRow, { key: alert.key, alert, onAck: actions.ackAlert, onOpen: () => actions.openDetail(alert.nodeId) })))
            ])
          : null,
        st.data?.self ? h(SelfPanel, { key: 'self', st, actions }) : null,
        h(HubPanel, { key: 'hub', st, actions }),
        h(DiscoveryPanel, { key: 'discovery', st, actions }),
        h('section', { key: 'nodes', className: 'nm-section' }, [
          h('div', { key: 'head', className: 'nm-section-head' }, [h('h3', { key: 'title' }, t('summary.nodes'))]),
          h('div', { key: 'filters', className: 'nm-filters' }, [
            h('input', {
              key: 'q',
              className: 'nm-input nm-filter-search',
              value: filter.q,
              placeholder: t('filter.searchPlaceholder'),
              'aria-label': t('filter.search'),
              onChange: (event) => actions.setFilter({ q: event.target.value })
            }),
            h(
              'select',
              {
                key: 'status',
                className: 'nm-input nm-filter-select',
                value: filter.status,
                onChange: (event) => actions.setFilter({ status: event.target.value })
              },
              [
                h('option', { key: 'all', value: 'all' }, t('filter.statusAll')),
                h('option', { key: 'online', value: 'online' }, t('status.online')),
                h('option', { key: 'degraded', value: 'degraded' }, t('status.degraded')),
                h('option', { key: 'offline', value: 'offline' }, t('status.offline')),
                h('option', { key: 'unknown', value: 'unknown' }, t('status.unknown'))
              ]
            ),
            allTags.length > 0
              ? h(
                  'select',
                  {
                    key: 'tag',
                    className: 'nm-input nm-filter-select',
                    value: filter.tag,
                    onChange: (event) => actions.setFilter({ tag: event.target.value })
                  },
                  [
                    h('option', { key: 'all', value: 'all' }, t('filter.tagAll')),
                    allTags.map((tag) => h('option', { key: tag, value: tag }, tag))
                  ]
                )
              : null,
            h('span', { key: 'count', className: 'nm-filter-count' }, t('filter.count', { shown: filtered.length, total: nodes.length })),
            filtered.length !== nodes.length
              ? h('button', { key: 'clear', className: 'nm-btn nm-btn--ghost', onClick: actions.clearFilter }, t('filter.clear'))
              : null
          ]),
          selectedIds.length > 0
            ? h('div', { key: 'batch', className: 'nm-batch' }, [
                h('span', { key: 'count', className: 'nm-batch-count' }, t('batch.selected', { count: selectedIds.length })),
                h('button', { key: 'all', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: () => actions.selectMany(visibleIds) }, t('batch.all')),
                h('button', { key: 'probe', className: 'nm-btn nm-btn--ghost nm-btn--sm', disabled: st.busy, onClick: () => actions.batch('probe') }, t('batch.probe')),
                h('button', { key: 'enable', className: 'nm-btn nm-btn--ghost nm-btn--sm', disabled: st.busy, onClick: () => actions.batch('enable') }, t('batch.enable')),
                h('button', { key: 'disable', className: 'nm-btn nm-btn--ghost nm-btn--sm', disabled: st.busy, onClick: () => actions.batch('disable') }, t('batch.disable')),
                h('button', { key: 'clear', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: actions.clearSelection }, t('batch.clear'))
              ])
            : null,
          h(
            'div',
            { key: 'grid', className: 'nm-grid' },
            filtered.map((node) =>
              h(NodeCard, {
                key: node.id,
                node,
                probe: probes[node.id],
                alertCount: alertCounts[node.id] || 0,
                selected: selectedIds.includes(node.id),
                onSelect: () => actions.toggleSelect(node.id),
                onOpen: () => actions.openDetail(node.id),
                onEdit: () => actions.openModal({ type: 'edit', node }),
                onOpenRemote: () => actions.openNode(node.id),
                onEmbed: () => actions.embedNode(node)
              })
            )
          ),
          filtered.length === 0
            ? h('p', { key: 'filterEmpty', className: 'nm-muted nm-filter-empty' }, t('filter.empty'))
            : null
        ]),
        h('section', { key: 'events', className: 'nm-section' }, [
          h('div', { key: 'head', className: 'nm-section-head' }, [h('h3', { key: 'title' }, t('events.title'))]),
          events.length === 0
            ? h('p', { key: 'empty', className: 'nm-muted' }, t('events.empty'))
            : h(
                'ul',
                { key: 'list', className: 'nm-event-list' },
                events.slice(0, 12).map((event, index) =>
                  h('li', { key: `${event.at}-${index}`, className: 'nm-event' }, [
                    h('span', { key: 'dot', className: `nm-event-dot nm-event-dot--${event.level || 'info'}` }),
                    h('span', { key: 'text', className: 'nm-event-text' }, eventText(event)),
                    h('span', { key: 'time', className: 'nm-event-time' }, fmtRelative(event.at))
                  ])
                )
              )
        ])
      ])
    }

    /* -------------------------------------------------------------- */
    /* 详情                                                            */
    /* -------------------------------------------------------------- */

    function InfoRow({ label, children }) {
      return h('div', { className: 'nm-info-row' }, [h('span', { key: 'label', className: 'nm-info-label' }, label), h('span', { key: 'value', className: 'nm-info-value' }, children)])
    }

    function Detail({ st, actions }) {
      const data = st.data
      const node = (data?.nodes || []).find((item) => item.id === st.selectedId) || (data?.nodes || [])[0]
      if (!node) return h(EmptyState, { onAdd: () => actions.openModal({ type: 'add' }) })
      const probe = data?.probes?.[node.id] || {}
      const snapshot = probe.snapshot || {}
      const metrics = snapshot.metrics || {}
      const sessions = snapshot.sessions || {}
      const alerts = (data?.alerts || []).filter((alert) => alert.nodeId === node.id)
      const remoteRecent = snapshot.recent || []
      const detailEvents = remoteRecent.length > 0
        ? remoteRecent
        : (data?.events || []).filter((event) => event?.params?.id === node.id || event?.params?.name === node.name)
      const status = probe.status || 'unknown'
      const autoNode =
        node.adapter === 'hub' || (Array.isArray(node.tags) && node.tags.includes('auto'))

      return h('div', { className: 'nm-body' }, [
        h('div', { key: 'top', className: 'nm-detail-head' }, [
          h('button', { key: 'back', className: 'nm-btn nm-btn--ghost', onClick: actions.back }, `← ${t('actions.back')}`),
          h('div', { key: 'name', className: 'nm-detail-title' }, [
            h(StatusPill, { key: 'status', status }),
            h('h2', { key: 'text' }, node.name),
            h('span', { key: 'url', className: 'nm-muted' }, node.baseUrl)
          ]),
          h('div', { key: 'actions', className: 'nm-detail-actions' }, [
            autoNode ? null : h('button', { key: 'embed', className: 'nm-btn nm-btn--ghost', title: t('embed.hint'), onClick: () => actions.embedNode(node) }, t('embed.actions')),
            autoNode ? null : h('button', { key: 'open', className: 'nm-btn', disabled: st.busy, title: t('node.openHint'), onClick: () => actions.openNode(node.id) }, `${t('node.open')} ↗`),
            h('button', { key: 'probe', className: 'nm-btn nm-btn--ghost', disabled: st.busy, onClick: () => actions.probeNode(node.id) }, t('actions.probe')),
            h('button', { key: 'edit', className: 'nm-btn nm-btn--ghost', onClick: () => actions.openModal({ type: 'edit', node }) }, t('actions.edit')),
            h('button', { key: 'remove', className: 'nm-btn nm-btn--danger', onClick: () => actions.openModal({ type: 'remove', node }) }, t('actions.remove'))
          ])
        ]),
        h('div', { key: 'metrics', className: 'nm-detail-metrics' }, [
          h(MetricBar, { key: 'cpu', label: t('node.cpu'), value: metrics.cpuPct }),
          h(MetricBar, { key: 'mem', label: t('node.mem'), value: metrics.memPct }),
          h(MetricBar, { key: 'disk', label: t('node.diskFree'), value: metrics.diskFreePct }),
          h(MetricBar, {
            key: 'sessions',
            label: t('node.sessionRunning'),
            value: sessions.total ? (sessions.running / sessions.total) * 100 : null,
            tone: 'var(--dsw-alias-brand-primary)'
          })
        ]),
        h('section', { key: 'info', className: 'nm-section' }, [
          h('div', { key: 'head', className: 'nm-section-head' }, [h('h3', { key: 'title' }, t('node.host'))]),
          h('div', { key: 'rows', className: 'nm-info-grid' }, [
            h(InfoRow, { key: 'base', label: t('node.baseUrl') }, node.baseUrl),
            h(InfoRow, { key: 'adapter', label: t('node.adapter') }, node.adapter === 'generic' ? t('adapter.generic') : t('adapter.dsh')),
            h(InfoRow, { key: 'network', label: t('node.network') }, t(`network.${node.network || 'lan'}`)),
            h(
              InfoRow,
              { key: 'login', label: t('node.login') },
              node.login?.configured ? `${t('login.configured')} · ${node.login.host}` : t('login.missing')
            ),
            h(InfoRow, { key: 'notes', label: t('node.notes') }, node.notes || '—'),
            h(InfoRow, { key: 'hostname', label: t('node.hostname') }, snapshot?.host?.hostname || '—'),
            h(InfoRow, { key: 'platform', label: t('node.host') }, snapshot?.host ? `${snapshot.host.platform || '—'} / ${snapshot.host.arch || '—'}` : '—'),
            h(InfoRow, { key: 'uptime', label: t('node.uptime') }, fmtUptime(snapshot?.host?.uptimeSec)),
            h(InfoRow, { key: 'latency', label: t('node.latency') }, fmtMs(probe.latencyMs)),
            h(InfoRow, { key: 'checked', label: t('node.checkedAt') }, fmtRelative(probe.checkedAt)),
            h(InfoRow, { key: 'seen', label: t('node.lastSeen') }, fmtRelative(probe.lastSeenAt)),
            h(InfoRow, { key: 'sessions', label: t('node.sessions') }, `${sessions.total ?? '—'} (${t('node.sessionRunning')} ${sessions.running ?? '—'})`),
            h(InfoRow, { key: 'load', label: t('node.load') }, metrics.load1 !== null && metrics.load1 !== undefined ? String(Math.round(metrics.load1 * 100) / 100) : '—'),
            h(InfoRow, { key: 'mem', label: t('node.mem') }, `${fmtBytes(metrics.memUsedBytes)} / ${fmtBytes(metrics.memTotalBytes)}`),
            h(InfoRow, { key: 'disk', label: t('node.diskFree') }, `${fmtBytes(metrics.diskFreeBytes)} / ${fmtBytes(metrics.diskTotalBytes)}`),
            h(InfoRow, { key: 'token', label: t('node.token') }, node.hasToken ? t('token.saved') : t('token.missing')),
            h(InfoRow, { key: 'protocol', label: t('node.protocol') }, snapshot?.protocol || '—')
          ]),
          probe?.error ? h('p', { key: 'error', className: 'nm-error-text' }, `${t('node.error')}：${reasonText(probe.error.code) === probe.error.message ? probe.error.message : `${reasonText(probe.error.code)}（${probe.error.message}）`}`) : null
        ]),
        h('section', { key: 'sessions', className: 'nm-section' }, [
          h('div', { key: 'head', className: 'nm-section-head' }, [
            h('h3', { key: 'title' }, t('sessions.title')),
            h('span', { key: 'hint', className: 'nm-section-hint' }, t('sessions.hint'))
          ]),
          (sessions.list || []).length === 0
            ? h('p', { key: 'empty', className: 'nm-muted' }, t('sessions.empty'))
            : h(
                'ul',
                { key: 'list', className: 'nm-session-list' },
                (sessions.list || []).map((session) =>
                  h('li', { key: session.id, className: 'nm-session' }, [
                    h('span', {
                      key: 'dot',
                      className: `nm-session-dot nm-session-dot--${session.status}`,
                      title: session.status === 'running' ? t('sessions.running') : t('sessions.idle')
                    }),
                    h('div', { key: 'main', className: 'nm-session-main' }, [
                      h('code', { key: 'id', className: 'nm-session-id' }, shortSession(session.id)),
                      session.depth
                        ? h('span', { key: 'sub', className: 'nm-chip nm-chip--muted' }, t('sessions.sub'))
                        : null,
                      session.model ? h('span', { key: 'model', className: 'nm-session-model' }, session.model) : null
                    ]),
                    h('div', { key: 'meta', className: 'nm-session-meta' }, [
                      baseName(session.cwd) ? h('span', { key: 'cwd', className: 'nm-session-cwd' }, baseName(session.cwd)) : null,
                      h('span', { key: 'time', className: 'nm-session-time' }, fmtRelative(session.lastAt))
                    ])
                  ])
                )
              )
        ]),
        h('section', { key: 'control', className: 'nm-section' }, [
          h('div', { key: 'head', className: 'nm-section-head' }, [
            h('h3', { key: 'title' }, t('control.title')),
            snapshot.control?.enabled ? h('span', { key: 'hint', className: 'nm-section-hint' }, t('control.audit')) : null
          ]),
          !snapshot.control?.enabled
            ? h('p', { key: 'off', className: 'nm-muted' }, autoNode ? t('control.readOnlyHint') : t('control.disabled'))
            : h('div', { key: 'body', className: 'nm-control' }, [
                h('div', { key: 'bar', className: 'nm-inline-actions' }, [
                  h(
                    'button',
                    {
                      key: 'load',
                      className: 'nm-btn nm-btn--ghost',
                      disabled: Boolean(st.control?.loading),
                      onClick: () => actions.controlList(node.id)
                    },
                    st.control?.loading ? t('control.loading') : st.control?.items?.length ? t('control.reload') : t('control.load')
                  ),
                  snapshot.control?.restart && !(st.controlPending?.kind === 'restart' && st.controlPending?.nodeId === node.id)
                    ? h(
                        'button',
                        { key: 'restart', className: 'nm-btn nm-btn--danger', onClick: () => actions.controlRestart(node.id, false) },
                        t('control.restart')
                      )
                    : null,
                  st.controlPending?.kind === 'restart' && st.controlPending?.nodeId === node.id
                    ? h('span', { key: 'restartConfirm', className: 'nm-inline-actions' }, [
                        h('span', { key: 'q', className: 'nm-control-warn' }, t('control.restartConfirm')),
                        h('button', { key: 'yes', className: 'nm-btn nm-btn--danger', onClick: () => actions.controlRestart(node.id, true) }, t('control.confirm')),
                        h('button', { key: 'no', className: 'nm-btn nm-btn--ghost', onClick: actions.controlCancel }, t('control.cancel'))
                      ])
                    : null
                ]),
                st.control?.error
                  ? h('p', { key: 'error', className: 'nm-control-warn' }, `${t('control.failed')}：${st.control.error}`)
                  : null,
                st.control?.nodeId === node.id && st.control?.items?.length
                  ? h(
                      'ul',
                      { key: 'list', className: 'nm-control-list' },
                      st.control.items.map((plugin) => {
                        const pending = st.controlPending?.kind === 'toggle' && Boolean(plugin.id) && st.controlPending?.id === plugin.id
                        return h('li', { key: plugin.id || plugin.name, className: 'nm-control-item' }, [
                          h('code', { key: 'name', className: 'nm-control-name' }, plugin.name || plugin.id),
                          h('span', { key: 'state', className: `nm-chip ${plugin.enabled ? 'nm-chip--ok' : 'nm-chip--muted'}` }, plugin.enabled ? t('control.enabled') : t('control.disabledChip')),
                          plugin.readOnly
                            ? h('span', { key: 'ro', className: 'nm-muted' }, t('control.readOnly'))
                            : pending
                              ? h('span', { key: 'confirm', className: 'nm-inline-actions' }, [
                                  h('span', { key: 'q', className: 'nm-control-warn' }, t('control.confirmToggle', { verb: pending.enabled ? t('control.enable') : t('control.disable'), name: plugin.name })),
                                  h('button', { key: 'yes', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: () => actions.controlToggle(node.id, plugin, true) }, t('control.confirm')),
                                  h('button', { key: 'no', className: 'nm-btn nm-btn--ghost nm-btn--sm', onClick: actions.controlCancel }, t('control.cancel'))
                                ])
                              : h(
                                  'button',
                                  {
                                    key: 'toggle',
                                    className: `nm-btn nm-btn--ghost nm-btn--sm`,
                                    onClick: () => actions.controlToggle(node.id, plugin, false)
                                  },
                                  plugin.enabled ? t('control.disable') : t('control.enable')
                                )
                        ])
                      })
                    )
                  : null
              ])
        ]),
        alerts.length > 0
          ? h('section', { key: 'alerts', className: 'nm-section' }, [
              h('div', { key: 'head', className: 'nm-section-head' }, [h('h3', { key: 'title' }, t('alerts.title'))]),
              h('ul', { key: 'list', className: 'nm-alert-list' }, alerts.map((alert) => h(AlertRow, { key: alert.key, alert, onAck: actions.ackAlert })))
            ])
          : null,
        h('section', { key: 'recent', className: 'nm-section' }, [
          h('div', { key: 'head', className: 'nm-section-head' }, [h('h3', { key: 'title' }, t('events.title'))]),
          detailEvents.length === 0
            ? h('p', { key: 'empty', className: 'nm-muted' }, t('events.empty'))
            : h(
                'ul',
                { key: 'list', className: 'nm-event-list' },
                detailEvents.map((event, index) =>
                  h('li', { key: `${event.at}-${index}`, className: 'nm-event' }, [
                    h('span', { key: 'dot', className: 'nm-event-dot nm-event-dot--info' }),
                    h('span', { key: 'text', className: 'nm-event-text' }, eventText(event)),
                    h('span', { key: 'time', className: 'nm-event-time' }, fmtRelative(event.at))
                  ])
                )
              )
        ]),
        h('p', { key: 'footer', className: 'nm-footer' }, t('footer.meta', { protocol: data?.protocol || '—', hostname: data?.server?.hostname || '—' }))
      ])
    }

    /* -------------------------------------------------------------- */
    /* 弹窗                                                            */
    /* -------------------------------------------------------------- */

    function Field({ label, hint, children }) {
      return h('label', { className: 'nm-field' }, [h('span', { key: 'label', className: 'nm-field-label' }, label), children, hint ? h('span', { key: 'hint', className: 'nm-field-hint' }, hint) : null])
    }

    function TextInput(props) {
      return h('input', { ...props, className: `nm-input${props.className ? ` ${props.className}` : ''}` })
    }

    function NumberInput(props) {
      return h('input', { type: 'number', ...props, className: `nm-input${props.className ? ` ${props.className}` : ''}` })
    }

    function NodeModal({ st, actions }) {
      const hostReady = typeof actions.hubReady === 'function' ? actions.hubReady() : true
      const modal = st.modal || {}
      const editing = modal.type === 'edit' && modal.node
      const node = modal.node
      const prefill = modal.prefill || {}
      const [form, setForm] = useState(() => ({
        name: node?.name || prefill.name || '',
        baseUrl: node?.baseUrl || prefill.baseUrl || '',
        adapter: node?.adapter || 'dsh',
        path: node?.path || '/health',
        token: '',
        tags: (node?.tags || []).filter((tag) => tag !== 'self').join(', '),
        enabled: node?.enabled !== false,
        network: node?.network || 'lan',
        notes: node?.notes || ''
      }))
      const [testing, setTesting] = useState(false)
      const [testResult, setTestResult] = useState(null)
      const [loginUrl, setLoginUrl] = useState('')
      const [loginInfo, setLoginInfo] = useState(node?.login || { configured: false, host: '' })
      const update = (patch) => setForm((current) => ({ ...current, ...patch }))

      const submit = async (event) => {
        event.preventDefault()
        const payload = {
          name: form.name,
          baseUrl: form.baseUrl,
          adapter: form.adapter,
          path: form.adapter === 'generic' ? form.path : null,
          tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
          enabled: form.enabled,
          network: form.network,
          notes: form.notes,
          token: form.token
        }
        try {
          if (editing) await actions.updateNode({ id: node.id, ...payload })
          else await actions.addNode(payload)
        } catch {
          /* toast 已展示 */
        }
      }

      const runTest = async () => {
        setTesting(true)
        setTestResult(null)
        try {
          const result = await actions.testNode({
            id: editing ? node.id : undefined,
            baseUrl: form.baseUrl,
            adapter: form.adapter,
            path: form.adapter === 'generic' ? form.path : null,
            token: form.token || undefined
          })
          setTestResult(result)
        } catch {
          /* toast 已展示 */
        } finally {
          setTesting(false)
        }
      }

      return h(
        'div',
        { className: 'nm-overlay', role: 'dialog', 'aria-modal': 'true' },
        h('form', { className: 'nm-modal', onSubmit: submit }, [
          h('div', { key: 'head', className: 'nm-modal-head' }, [
            h('h3', { key: 'title' }, editing ? t('modal.editTitle') : t('modal.addTitle')),
            h('button', { key: 'close', type: 'button', className: 'nm-icon-btn', onClick: actions.closeModal, 'aria-label': t('actions.close') }, '×')
          ]),
          h('div', { key: 'body', className: 'nm-modal-body' }, [
            h(Field, { key: 'name', label: t('modal.name') }, h(TextInput, { value: form.name, placeholder: t('modal.namePlaceholder'), maxLength: 64, onChange: (event) => update({ name: event.target.value }) })),
            h('p', { key: 'nameHint', className: 'nm-hint nm-hint--tight' }, t('modal.nameAuto')),
            h(Field, { key: 'url', label: t('modal.baseUrl') }, h(TextInput, { value: form.baseUrl, placeholder: t('modal.baseUrlPlaceholder'), required: true, maxLength: 500, onChange: (event) => { const value = event.target.value; const parsed = parseNodeLinkInput(value); if (parsed) { update({ baseUrl: parsed.baseUrl, token: parsed.token }); if (typeof actions.notifyNodeLinkParsed === 'function') actions.notifyNodeLinkParsed(); } else { update({ baseUrl: value }); } } })),
            h(Field, { key: 'adapter', label: t('modal.adapter') }, h('select', { className: 'nm-input', value: form.adapter, onChange: (event) => update({ adapter: event.target.value }) }, [
              h('option', { key: 'dsh', value: 'dsh' }, t('adapter.dsh')),
              h('option', { key: 'generic', value: 'generic' }, t('adapter.generic'))
            ])),
            form.adapter === 'generic'
              ? h(Field, { key: 'path', label: t('modal.path') }, h(TextInput, { value: form.path, placeholder: '/health', onChange: (event) => update({ path: event.target.value }) }))
              : null,
            h(
              Field,
              { key: 'network', label: t('modal.networkLabel') },
              h(
                'select',
                { className: 'nm-input', value: form.network, onChange: (event) => update({ network: event.target.value }) },
                ['lan', 'tailscale', 'tunnel', 'public'].map((value) => h('option', { key: value, value }, t(`network.${value}`)))
              )
            ),
            h(
              Field,
              { key: 'notes', label: t('modal.notes') },
              h(TextInput, { value: form.notes, placeholder: t('modal.notesPlaceholder'), maxLength: 120, onChange: (event) => update({ notes: event.target.value }) })
            ),
            h(Field, { key: 'token', label: t('modal.token'), hint: editing ? t('modal.tokenKeep') : t('modal.tokenScoped') }, h(TextInput, { type: 'password', autoComplete: 'off', value: form.token, placeholder: t('modal.tokenPlaceholder'), onChange: (event) => update({ token: event.target.value }) })),
            h(Field, { key: 'tags', label: t('node.tags') }, h(TextInput, { value: form.tags, placeholder: 'prod, cn-hangzhou', onChange: (event) => update({ tags: event.target.value }) })),
            h('label', { key: 'enabled', className: 'nm-check' }, [
              h('input', { key: 'box', type: 'checkbox', checked: form.enabled, onChange: (event) => update({ enabled: event.target.checked }) }),
              h('span', { key: 'text' }, t('modal.enabled'))
            ]),
            editing && !hostReady
              ? h('p', { key: 'loginRestart', className: 'nm-field-hint' }, t('login.needRestart'))
              : editing
              ? h('div', { key: 'login', className: 'nm-modal-section' }, [
                  h('div', { key: 'label', className: 'nm-section-label' }, t('modal.loginSection')),
                  h(
                    Field,
                    { key: 'loginUrl', label: t('node.login'), hint: t('modal.loginHint') },
                    h(TextInput, {
                      type: 'password',
                      autoComplete: 'off',
                      value: loginUrl,
                      placeholder: t('modal.loginPlaceholder'),
                      onChange: (event) => setLoginUrl(event.target.value)
                    })
                  ),
                  h('div', { key: 'row', className: 'nm-inline-actions' }, [
                    h(
                      'span',
                      { key: 'state', className: loginInfo.configured ? 'nm-card-login' : 'nm-muted' },
                      loginInfo.configured ? t('login.savedHost', { host: loginInfo.host }) : t('modal.loginEmpty')
                    ),
                    h(
                      'button',
                      {
                        key: 'saveLogin',
                        type: 'button',
                        className: 'nm-btn nm-btn--ghost',
                        disabled: !loginUrl.trim() || st.busy,
                        onClick: async () => {
                          try {
                            const data = await actions.setLogin(node.id, loginUrl.trim())
                            const next = (data?.nodes || []).find((item) => item.id === node.id)
                            if (next?.login) setLoginInfo(next.login)
                            setLoginUrl('')
                          } catch {
                            /* toast 已展示 */
                          }
                        }
                      },
                      t('actions.loginSave')
                    ),
                    loginInfo.configured
                      ? h(
                          'button',
                          {
                            key: 'clearLogin',
                            type: 'button',
                            className: 'nm-btn nm-btn--ghost',
                            disabled: st.busy,
                            onClick: async () => {
                              try {
                                const data = await actions.clearLogin(node.id)
                                const next = (data?.nodes || []).find((item) => item.id === node.id)
                                if (next?.login) setLoginInfo(next.login)
                              } catch {
                                /* toast 已展示 */
                              }
                            }
                          },
                          t('actions.loginClear')
                        )
                      : null
                  ])
                ])
              : h('p', { key: 'loginHint', className: 'nm-field-hint' }, t('login.afterSave')),
            testResult
              ? h(
                  'p',
                  { key: 'test', className: `nm-test ${testResult.success ? 'nm-test--ok' : 'nm-test--fail'}` },
                  testResult.success
                    ? t('modal.testOk', { latency: fmtMs(testResult.latencyMs) })
                    : t('modal.testFail', { reason: reasonText(testResult.error?.code) })
                )
              : null
          ]),
          h('div', { key: 'foot', className: 'nm-modal-foot' }, [
            h('button', { key: 'test', type: 'button', className: 'nm-btn nm-btn--ghost', disabled: testing || st.busy, onClick: runTest }, testing ? '…' : t('actions.test')),
            h('button', { key: 'cancel', type: 'button', className: 'nm-btn nm-btn--ghost', onClick: actions.closeModal }, t('actions.cancel')),
            h('button', { key: 'save', type: 'submit', className: 'nm-btn', disabled: st.busy || !form.baseUrl.trim() }, st.busy ? '…' : t('actions.save'))
          ])
        ])
      )
    }

    function SettingsModal({ st, actions }) {
      const settings = st.data?.settings || {}
      const [form, setForm] = useState(() => ({ ...settings }))
      const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))
      const submit = async (event) => {
        event.preventDefault()
        try {
          await actions.saveSettings(form)
        } catch {
          /* toast 已展示 */
        }
      }
      const fields = [
        ['refreshMs', 'modal.refreshMs'],
        ['timeoutMs', 'modal.timeoutMs'],
        ['latencyWarnMs', 'modal.latencyWarnMs'],
        ['cpuWarnPct', 'modal.cpuWarnPct'],
        ['memWarnPct', 'modal.memWarnPct'],
        ['diskWarnFreePct', 'modal.diskWarnFreePct']
      ]
      return h(
        'div',
        { className: 'nm-overlay', role: 'dialog', 'aria-modal': 'true' },
        h('form', { className: 'nm-modal', onSubmit: submit }, [
          h('div', { key: 'head', className: 'nm-modal-head' }, [
            h('h3', { key: 'title' }, t('modal.settingsTitle')),
            h('button', { key: 'close', type: 'button', className: 'nm-icon-btn', onClick: actions.closeModal, 'aria-label': t('actions.close') }, '×')
          ]),
          h(
            'div',
            { key: 'body', className: 'nm-modal-body nm-modal-body--grid' },
            fields.map(([key, label]) =>
              h(Field, { key, label: t(label) }, h(NumberInput, { value: form[key] ?? '', min: 0, onChange: (event) => update(key, Number(event.target.value)) }))
            )
          ),
          h('div', { key: 'foot', className: 'nm-modal-foot' }, [
            h('button', { key: 'cancel', type: 'button', className: 'nm-btn nm-btn--ghost', onClick: actions.closeModal }, t('actions.cancel')),
            h('button', { key: 'save', type: 'submit', className: 'nm-btn', disabled: st.busy }, t('actions.save'))
          ])
        ])
      )
    }

    function RemoveModal({ st, actions }) {
      const node = st.modal?.node
      if (!node) return null
      return h(
        'div',
        { className: 'nm-overlay', role: 'dialog', 'aria-modal': 'true' },
        h('div', { className: 'nm-modal nm-modal--small' }, [
          h('div', { key: 'head', className: 'nm-modal-head' }, [h('h3', { key: 'title' }, t('confirm.removeTitle'))]),
          h('p', { key: 'body', className: 'nm-modal-body' }, t('confirm.removeBody', { name: node.name })),
          h('div', { key: 'foot', className: 'nm-modal-foot' }, [
            h('button', { key: 'cancel', type: 'button', className: 'nm-btn nm-btn--ghost', onClick: actions.closeModal }, t('actions.cancel')),
            h('button', { key: 'remove', type: 'button', className: 'nm-btn nm-btn--danger', disabled: st.busy, onClick: () => actions.removeNode(node.id) }, t('confirm.remove'))
          ])
        ])
      )
    }

    /* -------------------------------------------------------------- */
    /* 主面板                                                          */
    /* -------------------------------------------------------------- */

    /**
     * 面板级错误边界：任何渲染期异常都只降级为本面板的提示，
     * 绝不冒泡到宿主 UI（这是「插件把整站带崩」的最后一道保险）。
     */
    class PanelBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error) {
        try {
          console.error('[node-monitor] panel crashed', error)
        } catch {
          /* ignore */
        }
      }

      render() {
        if (this.state.error) {
          return h('div', { className: 'nm-panel' }, [
            h('div', { key: 'banner', className: 'nm-banner' }, [h('span', { key: 'text' }, t('error.crash'))]),
            h(
              'div',
              { key: 'actions', style: { padding: '0 20px 24px' } },
              h(
                'button',
                {
                  key: 'reload',
                  className: 'nm-btn',
                  onClick: () => {
                    try {
                      window.location.reload()
                    } catch {
                      /* ignore */
                    }
                  }
                },
                t('actions.retry')
              )
            )
          ])
        }
        return this.props.children ?? null
      }
    }

    function SafePanel() {
      return h(PanelBoundary, null, h(MonitorPanel, null))
    }

    function SafeIcon(props) {
      try {
        return MonitorIcon(props)
      } catch {
        return h('span', { className: 'nm-panel-icon' }, h('svg', { width: props?.size ?? 18, height: props?.size ?? 18 }))
      }
    }

    function EmbedOverlay({ st, actions }) {
      const embed = st.embed
      if (!embed) return null
      return h('div', { className: 'nm-embed-backdrop', role: 'dialog', 'aria-modal': 'true' }, [
        h('div', { className: 'nm-embed' }, [
          h('div', { className: 'nm-embed-head' }, [
            h('span', { key: 'title', className: 'nm-embed-title' }, embed.name || t('embed.actions')),
            h('span', { key: 'spacer', className: 'nm-embed-spacer' }),
            embed.url
              ? h('a', { key: 'tab', className: 'nm-btn nm-btn--ghost', href: embed.url, target: '_blank', rel: 'noreferrer noopener' }, t('embed.openTab'))
              : null,
            h('button', { key: 'close', className: 'nm-btn nm-btn--ghost', onClick: actions.closeEmbed }, t('embed.close'))
          ]),
          embed.loading
            ? h('div', { key: 'loading', className: 'nm-embed-loading' }, [h(Spinner, { key: 's' }), h('span', { key: 't' }, t('embed.loading'))])
            : embed.error
              ? h('p', { key: 'error', className: 'nm-banner' }, embed.error)
              : h('iframe', {
                  key: 'frame',
                  className: 'nm-embed-frame',
                  src: embed.url,
                  title: embed.name,
                  sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads'
                })
        ])
      ])
    }

    function MonitorPanel() {
      const st = useStore(store)
      const data = st.data
      const summary = data?.summary
      const token = data?.token
      useLocaleTick(window.__DSH_NODE_MONITOR_CTX__)

      return h('div', { className: 'nm-panel' }, [
        h('header', { key: 'head', className: 'nm-head' }, [
          h('div', { key: 'title', className: 'nm-title' }, [h('h2', { key: 'h' }, t('title')), h('p', { key: 'p' }, t('subtitle'))]),
          h('div', { key: 'actions', className: 'nm-head-actions' }, [
            h('button', { key: 'refresh', className: 'nm-btn nm-btn--ghost', disabled: st.busy, onClick: () => store.actions.load({ silent: false }) }, st.busy ? '…' : t('actions.refresh')),
            h('button', { key: 'add', className: 'nm-btn nm-btn--ghost', onClick: () => store.actions.openModal({ type: 'add' }) }, t('actions.add')),
            h('button', { key: 'settings', className: 'nm-btn nm-btn--ghost', onClick: () => store.actions.openModal({ type: 'settings' }) }, t('actions.settings'))
          ])
        ]),
        summary
          ? h('div', { key: 'summary', className: 'nm-summary' }, [
              h(Chip, { key: 'nodes', tone: 'neutral' }, `${t('summary.nodes')} ${summary.total}`),
              h(Chip, { key: 'online', tone: 'ok' }, `${t('summary.online')} ${summary.online}`),
              h(Chip, { key: 'degraded', tone: 'warn' }, `${t('summary.degraded')} ${summary.degraded}`),
              h(Chip, { key: 'offline', tone: 'error' }, `${t('summary.offline')} ${summary.offline}`),
              h(Chip, { key: 'alerts', tone: summary.alertsOpen > 0 ? 'error' : 'neutral' }, `${t('summary.alerts')} ${summary.alertsOpen}`)
            ])
          : null,
        token
          ? h('div', { key: 'token', className: 'nm-token' }, [
              h('span', { key: 'title', className: 'nm-token-title' }, `${t('token.title')} · ${token.agentEndpointEnabled ? t('token.enabled') : t('token.missing')}`),
              h('span', { key: 'source', className: 'nm-muted' }, token.source === 'env' ? t('token.source.env') : t('token.source.file')),
              h('span', { key: 'hint', className: 'nm-token-hint' }, t('token.hint'))
            ])
          : null,
        st.error ? h('div', { key: 'error', className: 'nm-banner' }, [h('span', { key: 'text' }, st.error), h('button', { key: 'retry', className: 'nm-btn nm-btn--ghost', onClick: () => store.actions.load({ silent: false }) }, t('actions.retry'))]) : null,
        st.phase === 'loading' && !data ? h('div', { key: 'loading', className: 'nm-loading' }, [h(Spinner, { key: 's' }), h('span', { key: 't' }, t('loading'))]) : null,
        st.view === 'detail' ? h(Detail, { key: 'detail', st, actions: store.actions }) : h(Overview, { key: 'overview', st, actions: store.actions }),
        st.modal?.type === 'add' || st.modal?.type === 'edit' ? h(NodeModal, { key: 'node-modal', st, actions: store.actions }) : null,
        st.modal?.type === 'settings' ? h(SettingsModal, { key: 'settings-modal', st, actions: store.actions }) : null,
        st.modal?.type === 'remove' ? h(RemoveModal, { key: 'remove-modal', st, actions: store.actions }) : null,
        st.embed ? h(EmbedOverlay, { key: 'embed', st, actions: store.actions }) : null,
        st.toast ? h('div', { key: 'toast', className: `nm-toast nm-toast--${st.toast.kind}` }, st.toast.text) : null
      ])
    }

    /* -------------------------------------------------------------- */
    /* 样式                                                            */
    /* -------------------------------------------------------------- */

    const CSS = `
.nm-panel { display:flex; flex-direction:column; gap:14px; padding:22px 24px 34px; height:100%; overflow-y:auto; box-sizing:border-box; color:var(--dsw-alias-label-primary); font-size:13px; }
.nm-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.nm-title h2 { margin:0; font-size:19px; font-weight:650; letter-spacing:.2px; }
.nm-title p { margin:5px 0 0; color:var(--dsw-alias-label-secondary); font-size:12.5px; }
.nm-head-actions { display:flex; gap:8px; flex-wrap:wrap; }
.nm-btn { appearance:none; border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); border-radius:8px; padding:6px 12px; font-size:12.5px; cursor:pointer; transition:background .15s ease,border-color .15s ease; line-height:1.4; }
.nm-btn:hover { background:var(--dsw-alias-interactive-bg-hover); }
.nm-btn:disabled { opacity:.55; cursor:not-allowed; }
.nm-btn--ghost { background:transparent; }
.nm-btn--danger { color:var(--dsw-alias-state-error-primary); border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent); }
.nm-icon-btn { border:none; background:transparent; color:var(--dsw-alias-label-tertiary); cursor:pointer; font-size:16px; line-height:1; padding:3px 6px; border-radius:6px; }
.nm-icon-btn:hover { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.nm-summary { display:flex; gap:8px; flex-wrap:wrap; }
.nm-chip { display:inline-flex; align-items:center; gap:6px; border-radius:999px; padding:3px 10px; font-size:12px; background:var(--dsw-alias-bg-layer-2); border:1px solid var(--dsw-alias-border-l1); color:var(--dsw-alias-label-secondary); }
.nm-chip--ok { color:var(--dsw-alias-state-success-primary); }
.nm-chip--warn { color:var(--dsw-alias-state-warn-primary); }
.nm-chip--error { color:var(--dsw-alias-state-error-primary); }
.nm-token { display:flex; flex-direction:column; gap:3px; border:1px dashed var(--dsw-alias-border-l2); border-radius:10px; padding:9px 12px; background:var(--dsw-alias-bg-layer-1); }
.nm-token-title { font-weight:600; font-size:12.5px; }
.nm-token-hint { color:var(--dsw-alias-label-tertiary); font-size:11.5px; line-height:1.5; }
.nm-banner { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:9px 12px; border-radius:10px; background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); color:var(--dsw-alias-state-error-primary); }
.nm-loading { display:flex; align-items:center; gap:10px; color:var(--dsw-alias-label-secondary); padding:24px 0; }
.nm-spinner { width:14px; height:14px; border-radius:50%; border:2px solid var(--dsw-alias-border-l2); border-top-color:var(--dsw-alias-brand-primary); animation:nm-spin .8s linear infinite; display:inline-block; }
@keyframes nm-spin { to { transform:rotate(360deg); } }
.nm-section-hint { color:var(--dsw-alias-label-tertiary); font-size:11px; }
.nm-filters { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin:0 0 12px; }
.nm-filter-search { flex:1 1 180px; max-width:280px; }
.nm-filters .nm-input.nm-filter-select { flex:0 0 auto; width:auto; min-width:120px; }
.nm-filter-count { color:var(--dsw-alias-label-tertiary); font-size:12px; }
.nm-filter-empty { margin-top:8px; }
.nm-tag--group { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); border-color:var(--dsw-alias-border-l1); }
.nm-control { display:flex; flex-direction:column; gap:8px; }
.nm-control-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }
.nm-control-item { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:6px 8px; border:1px solid var(--dsw-alias-border-l1); border-radius:8px; background:var(--dsw-alias-bg-layer-1); }
.nm-control-name { flex:1 1 160px; font-size:12px; color:var(--dsw-alias-label-primary); }
.nm-control-warn { color:var(--dsw-alias-state-warn-primary); font-size:12px; }
.nm-btn--danger { color:var(--dsw-alias-state-error-primary); border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent); }
.nm-btn--sm { padding:2px 8px; font-size:12px; }
.nm-embed-backdrop { position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center; background:color-mix(in srgb, #000 42%, transparent); padding:16px; }
.nm-embed { width:min(1180px, 96vw); height:min(820px, 88vh); display:flex; flex-direction:column; background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l2); border-radius:12px; overflow:hidden; box-shadow:0 24px 60px rgba(0,0,0,.35); }
.nm-embed-head { display:flex; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid var(--dsw-alias-border-l1); }
.nm-embed-title { font-size:13px; font-weight:600; color:var(--dsw-alias-label-primary); }
.nm-embed-spacer { flex:1; }
.nm-embed-loading { flex:1; display:flex; align-items:center; justify-content:center; gap:8px; color:var(--dsw-alias-label-secondary); }
.nm-embed-frame { flex:1; width:100%; border:0; background:#fff; }
@media (max-width:760px){ .nm-embed{width:100vw;height:100vh;border-radius:0;} .nm-embed-backdrop{padding:0;} }
@media (max-width:760px){ .nm-filter-search{max-width:none;flex-basis:100%;} .nm-filter-select{flex:1 1 40%;width:auto;} .nm-grid{grid-template-columns:1fr;} }
.nm-session-list { list-style:none; margin:0; padding:0; border:1px solid var(--dsw-alias-border-l1); border-radius:10px; overflow:hidden; }
.nm-session { display:flex; align-items:center; gap:10px; padding:9px 12px; border-top:1px solid var(--dsw-alias-border-l1); }
.nm-session:first-child { border-top:0; }
.nm-session-dot { width:8px; height:8px; border-radius:50%; flex:0 0 auto; background:var(--dsw-alias-label-tertiary); }
.nm-session-dot--running { background:var(--dsw-alias-state-success-primary); }
.nm-session-main { display:flex; align-items:center; gap:8px; min-width:0; }
.nm-session-id { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; color:var(--dsw-alias-label-primary); }
.nm-session-model { color:var(--dsw-alias-label-tertiary); font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.nm-session-meta { margin-left:auto; display:flex; align-items:center; gap:10px; color:var(--dsw-alias-label-tertiary); font-size:12px; white-space:nowrap; }
.nm-session-cwd { max-width:180px; overflow:hidden; text-overflow:ellipsis; }
.nm-body { display:flex; flex-direction:column; gap:16px; }
.nm-section { display:flex; flex-direction:column; gap:9px; }
.nm-section-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.nm-section-head h3 { margin:0; font-size:13px; font-weight:650; color:var(--dsw-alias-label-secondary); text-transform:uppercase; letter-spacing:.4px; }
.nm-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 420px)); justify-content:start; gap:12px; }
.nm-card { display:flex; flex-direction:column; gap:9px; border:1px solid var(--dsw-alias-border-l1); border-radius:12px; background:var(--dsw-alias-bg-layer-1); padding:12px 13px; cursor:pointer; transition:border-color .15s ease, box-shadow .15s ease; }
.nm-card:hover, .nm-card:focus-visible { border-color:var(--dsw-alias-border-l2); box-shadow:0 2px 10px color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent); outline:none; }
.nm-card--offline { border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, var(--dsw-alias-border-l1)); }
.nm-card--degraded { border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, var(--dsw-alias-border-l1)); }
.nm-card-head { display:flex; align-items:flex-start; flex-wrap:wrap; gap:6px 8px; }
.nm-self-grid { display:grid; gap:6px; margin-top:6px; }
.nm-hub-form { display:flex; gap:8px; flex-wrap:wrap; margin:8px 0; }
.nm-hub-share { margin:8px 0 4px; }
.nm-qr { border:1px solid var(--dsw-alias-border-l2); border-radius:10px; padding:12px; margin:10px 0; background:var(--dsw-alias-bg-layer-2); }
.nm-qr-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
.nm-qr-svg svg { width:min(260px, 70vw); height:auto; display:block; background:#fff; padding:8px; border-radius:8px; }
.nm-qr-link { display:block; word-break:break-all; font-size:11px; color:var(--dsw-alias-label-tertiary); margin:8px 0 4px; }
.nm-hub-form .nm-input { flex:1 1 220px; }
.nm-hub { margin-top:10px; }
@media (max-width:760px) { .nm-hub-form { flex-direction:column; } .nm-hub-form .nm-input { width:100%; } }
.nm-self-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.nm-self-row--token { border-top:1px dashed var(--dsw-alias-border-l2); padding-top:8px; margin-top:2px; }
.nm-self-label { flex:0 0 72px; color:var(--dsw-alias-label-secondary); font-size:12px; }
.nm-self-value { font-family:var(--dsw-font-family-mono, ui-monospace, monospace); color:var(--dsw-alias-label-primary); font-size:13px; }
.nm-self-token { font-family:var(--dsw-font-family-mono, ui-monospace, monospace); font-size:13px; letter-spacing:0.3px; padding:2px 6px; border-radius:4px; background:var(--dsw-alias-bg-layer-2); }
.nm-self-token--hidden { color:var(--dsw-alias-label-tertiary); }
.nm-self-input { width:180px; }
.nm-self-actions { display:flex; gap:6px; align-items:center; }
.nm-hint--tight { margin:-4px 0 10px; }
.nm-hint { margin:4px 0 8px; color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:1.5; }
.nm-empty-inline { margin:0; color:var(--dsw-alias-label-tertiary); font-size:12px; }
.nm-discovery-list { list-style:none; margin:0; padding:0; display:grid; gap:8px; }
.nm-discovery-item { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; }
.nm-discovery-main { display:grid; gap:2px; min-width:0; }
.nm-discovery-meta { font-size:11px; }
.nm-card-pick { margin:3px 0 0; flex:none; width:14px; height:14px; accent-color:var(--dsw-alias-brand-primary); cursor:pointer; }
.nm-batch { display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin:0 0 10px; padding:6px 8px; border:1px dashed var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-2); }
.nm-batch-count { font-size:12px; font-weight:600; margin-right:2px; }
.nm-card-title { flex:1; min-width:0; }
.nm-card-name { font-weight:650; font-size:13.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.nm-card-title { flex:1 1 132px; min-width:0; }
.nm-card-url { color:var(--dsw-alias-label-tertiary); font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:2px; }
.nm-card-meta { display:flex; gap:10px; flex-wrap:wrap; color:var(--dsw-alias-label-tertiary); font-size:11.5px; }
.nm-card-foot { display:flex; gap:10px; flex-wrap:wrap; color:var(--dsw-alias-label-secondary); font-size:11.5px; border-top:1px solid var(--dsw-alias-border-l1); padding-top:8px; margin-top:2px; }
.nm-card-alert { color:var(--dsw-alias-state-error-primary); }
.nm-card-error { color:var(--dsw-alias-state-warn-primary); max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.nm-dot { width:8px; height:8px; border-radius:50%; display:inline-block; flex:none; margin-top:4px; background:var(--dsw-alias-label-tertiary); }
.nm-dot--online { background:var(--dsw-alias-state-success-primary); }
.nm-dot--degraded { background:var(--dsw-alias-state-warn-primary); }
.nm-dot--offline { background:var(--dsw-alias-state-error-primary); }
.nm-tag { font-size:10.5px; border-radius:5px; padding:1px 6px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); border:1px solid var(--dsw-alias-border-l1); flex:none; }
.nm-pill { display:inline-flex; align-items:center; gap:6px; border-radius:999px; padding:2px 9px; font-size:11.5px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); }
.nm-pill--online { color:var(--dsw-alias-state-success-primary); }
.nm-pill--degraded { color:var(--dsw-alias-state-warn-primary); }
.nm-pill--offline { color:var(--dsw-alias-state-error-primary); }
.nm-metric { display:flex; flex-direction:column; gap:4px; }
.nm-metric-head { display:flex; justify-content:space-between; color:var(--dsw-alias-label-tertiary); font-size:11.5px; }
.nm-metric-value { color:var(--dsw-alias-label-secondary); }
.nm-metric-track { height:5px; border-radius:999px; background:var(--dsw-alias-bg-layer-2); overflow:hidden; }
.nm-metric-fill { height:100%; border-radius:999px; transition:width .3s ease; }
.nm-detail-head { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.nm-detail-title { display:flex; align-items:center; gap:9px; flex-wrap:wrap; flex:1; }
.nm-detail-title h2 { margin:0; font-size:17px; font-weight:650; }
.nm-detail-actions { display:flex; gap:8px; flex-wrap:wrap; }
.nm-detail-metrics { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; border:1px solid var(--dsw-alias-border-l1); border-radius:12px; padding:12px 14px; background:var(--dsw-alias-bg-layer-1); }
.nm-info-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:0 28px; }
.nm-info-row { display:flex; justify-content:flex-start; align-items:baseline; gap:10px; padding:6px 0; border-bottom:1px dashed var(--dsw-alias-border-l1); font-size:12px; }
.nm-info-label { color:var(--dsw-alias-label-tertiary); flex:none; width:74px; }
.nm-info-value { color:var(--dsw-alias-label-primary); text-align:left; word-break:break-all; min-width:0; flex:1 1 auto; }
.nm-error-text { color:var(--dsw-alias-state-error-primary); font-size:12px; margin:8px 0 0; }
.nm-alert-list, .nm-event-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }
.nm-alert { display:flex; align-items:center; gap:9px; padding:8px 11px; border-radius:10px; background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); }
.nm-alert--critical { border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 36%, var(--dsw-alias-border-l1)); }
.nm-alert--warning { border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, var(--dsw-alias-border-l1)); }
.nm-alert-dot { width:7px; height:7px; border-radius:50%; flex:none; background:var(--dsw-alias-label-tertiary); }
.nm-alert--critical .nm-alert-dot { background:var(--dsw-alias-state-error-primary); }
.nm-alert--warning .nm-alert-dot { background:var(--dsw-alias-state-warn-primary); }
.nm-alert-body { flex:1; min-width:0; }
.nm-alert-title { font-size:12.5px; }
.nm-alert-meta { display:flex; gap:9px; flex-wrap:wrap; color:var(--dsw-alias-label-tertiary); font-size:11px; margin-top:2px; }
.nm-event { display:flex; align-items:center; gap:9px; padding:5px 2px; font-size:12px; }
.nm-event-dot { width:5px; height:5px; border-radius:50%; flex:none; background:var(--dsw-alias-label-tertiary); }
.nm-event-dot--warning { background:var(--dsw-alias-state-warn-primary); }
.nm-event-dot--critical { background:var(--dsw-alias-state-error-primary); }
.nm-event-text { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.nm-event-time { color:var(--dsw-alias-label-tertiary); font-size:11px; flex:none; }
.nm-muted { color:var(--dsw-alias-label-tertiary); }
.nm-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; gap:10px; padding:56px 18px; color:var(--dsw-alias-label-secondary); }
.nm-empty-icon { font-size:30px; color:var(--dsw-alias-label-tertiary); }
.nm-empty h3 { margin:0; font-size:15px; color:var(--dsw-alias-label-primary); }
.nm-empty p { margin:0; max-width:520px; line-height:1.65; font-size:12.5px; }
.nm-overlay { position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center; padding:22px; background:color-mix(in srgb, #000 38%, transparent); }
.nm-modal { width:min(560px, 100%); max-height:88vh; overflow-y:auto; border-radius:14px; background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l2); box-shadow:0 18px 48px rgba(0,0,0,.28); display:flex; flex-direction:column; }
.nm-modal--small { width:min(420px, 100%); }
.nm-modal-head { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:14px 16px 4px; }
.nm-modal-head h3 { margin:0; font-size:14.5px; font-weight:650; }
.nm-modal-body { display:flex; flex-direction:column; gap:11px; padding:10px 16px 14px; }
.nm-modal-body--grid { display:grid; grid-template-columns:1fr 1fr; gap:11px 14px; }
.nm-modal-foot { display:flex; justify-content:flex-end; gap:8px; padding:10px 16px 15px; border-top:1px solid var(--dsw-alias-border-l1); }
.nm-field { display:flex; flex-direction:column; gap:4px; }
.nm-field-label { font-size:12px; color:var(--dsw-alias-label-secondary); }
.nm-field-hint { font-size:11px; color:var(--dsw-alias-label-tertiary); line-height:1.5; }
.nm-input { appearance:none; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); padding:7px 10px; font-size:12.5px; outline:none; width:100%; box-sizing:border-box; }
.nm-input:focus { border-color:var(--dsw-alias-brand-primary); }
.nm-check { display:flex; align-items:center; gap:7px; font-size:12.5px; color:var(--dsw-alias-label-secondary); }
.nm-test { margin:0; font-size:12px; padding:7px 10px; border-radius:8px; background:var(--dsw-alias-bg-layer-2); }
.nm-test--ok { color:var(--dsw-alias-state-success-primary); }
.nm-test--fail { color:var(--dsw-alias-state-error-primary); }
.nm-footer { margin:4px 0 0; color:var(--dsw-alias-label-tertiary); font-size:11px; }
.nm-toast { position:fixed; right:22px; bottom:22px; z-index:70; padding:9px 14px; border-radius:10px; font-size:12.5px; max-width:min(420px, 80vw); box-shadow:0 8px 26px rgba(0,0,0,.22); background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l2); color:var(--dsw-alias-label-primary); }
.nm-toast--error { color:var(--dsw-alias-state-error-primary); border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, var(--dsw-alias-border-l2)); }
.nm-toast--ok { color:var(--dsw-alias-state-success-primary); }
.nm-card-open { flex:none; white-space:nowrap; font-size:11px; line-height:1.6; padding:0 7px; border-radius:6px; border:1px solid var(--dsw-alias-border-l2); background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; }
.nm-card-open:hover { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.nm-card-login { color:var(--dsw-alias-state-success-primary); }
.nm-modal-section { display:flex; flex-direction:column; gap:8px; border-top:1px solid var(--dsw-alias-border-l1); padding-top:12px; margin-top:2px; }
.nm-section-label { font-size:12px; font-weight:650; color:var(--dsw-alias-label-secondary); }
.nm-inline-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.nm-inline-actions .nm-btn { flex:none; }
.nm-muted { color:var(--dsw-alias-label-tertiary); }

@media (max-width: 760px) {
  .nm-panel { padding:14px 12px 26px; }
  .nm-head { flex-direction:column; }
  .nm-grid { grid-template-columns:1fr; }
  .nm-detail-head { align-items:flex-start; }
  .nm-detail-actions { width:100%; }
  .nm-detail-actions .nm-btn { flex:1; }
  .nm-modal-body--grid { grid-template-columns:1fr; }
  .nm-overlay { padding:0; align-items:flex-end; }
  .nm-modal { border-radius:14px 14px 0 0; max-height:92vh; width:100%; }
  .nm-info-row { flex-direction:column; gap:2px; }
  .nm-card-head { flex-wrap:wrap; }
  .nm-card-open { order:3; }
  .nm-inline-actions { width:100%; }
  .nm-inline-actions .nm-btn { flex:1; }
  .nm-info-value { text-align:left; }
}
`

    /* -------------------------------------------------------------- */
    /* 注册                                                            */
    /* -------------------------------------------------------------- */

    async function apply(ctx) {
      window.__DSH_NODE_MONITOR_CTX__ = ctx
      try {
        localeReader = ctx.locale ?? null
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'node-monitor: locale')
      } catch (error) {
        console.error('[node-monitor] locale stage failed', error)
      }

      try {
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = PLUGIN_ID
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'node-monitor: style')
      } catch (error) {
        console.error('[node-monitor] style stage failed', error)
      }

      try {
        store = createStore(ctx)
        ctx.effect(() => () => store && store.dispose(), 'node-monitor: polling')
      } catch (error) {
        console.error('[node-monitor] store stage failed', error)
      }

      try {
        // 返回的 disposer 已绑定到插件 context 的生命周期；HMR 重建时由 slots 服务回收。
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: ORDER,
              locale: NS,
              label: () => {
                try {
                  return t('panel')
                } catch {
                  return '节点监控'
                }
              }
            },
            SafeIcon
          )
        )
      } catch (error) {
        console.error('[node-monitor] sidebar entry failed', error)
      }

      try {
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, SafePanel))
      } catch (error) {
        console.error('[node-monitor] main panel failed', error)
      }
    }

    return { apply, inject: ['slots', 'locale', 'connection'] }
  }
})
