/**
 * dsh-node-monitor — 纯逻辑核心。
 *
 * 这里不 import 任何 Cordis / DSH 运行时包，也不访问文件系统与网络，
 * 便于用 `node --test` 在宿主机上独立验证：节点校验、探测解析、状态归并、
 * 告警推导、快照清洗与令牌比较。
 *
 * 数据契约（客户端与宿主共享）：
 *   Node      节点配置（不含任何令牌）
 *   Probe     一次探测的结果记录（不含令牌）
 *   Snapshot  单个节点上报的工作快照（由适配层清洗后使用）
 *   Alert     由状态推导出的告警（code + params 由前端翻译）
 *   State     宿主通过 RPC 返回给面板的完整视图
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

export const PROTOCOL = 'dsh.node-monitor/1'
export const PANEL_ID = 'node-monitor'
export const RPC_CHANNEL = '/node-monitor-rpc'
export const AGENT_PREFIX = '/node-monitor/api/v1'
export const AGENT_STATUS_PATH = `${AGENT_PREFIX}/status`
export const AGENT_HEALTH_PATH = `${AGENT_PREFIX}/health`
export const CONTROL_PATH = `${AGENT_PREFIX}/control`

export const ADAPTERS = /** @type {const} */ (['dsh', 'generic'])

/** 节点所在网络形态（仅用于展示 / 筛选，不参与探测逻辑）。 */
export const NETWORKS = /** @type {const} */ (['lan', 'tailscale', 'tunnel', 'public'])

/** 控制台「打开节点」路由：校验一次性票据后 302 到该节点的登录地址。 */
export const OPEN_PATH = '/node-monitor/open'
export const PAIR_PATH = `${AGENT_PREFIX}/pair`
export const HUB_PUSH_PATH = `${AGENT_PREFIX}/hub/push`
export const HUB_RESULT_PATH = `${AGENT_PREFIX}/hub/result`

/** 登录材料（token URL）允许的最大长度。 */
export const LOGIN_URL_MAX = 1500

/** 节点侧运维动作白名单；`plugins.setEnabled` 与 `restart` 需要 confirm，默认干跑。 */
export const CONTROL_ACTIONS = /** @type {const} */ (['plugins.list', 'bundles.list', 'plugins.setEnabled', 'restart'])
export const STATUSES = /** @type {const} */ (['unknown', 'online', 'degraded', 'offline'])

export const SEVERITIES = /** @type {const} */ (['critical', 'warning', 'info'])

/** 默认阈值 / 轮询参数；可被插件设置覆盖。 */
export const DEFAULT_SETTINGS = Object.freeze({
  refreshMs: 5000,
  timeoutMs: 4000,
  offlineAfterFailures: 2,
  latencyWarnMs: 1500,
  cpuWarnPct: 85,
  memWarnPct: 90,
  diskWarnFreePct: 10,
  eventsLimit: 40
})

const MIN_REFRESH_MS = 2000
const MAX_REFRESH_MS = 120000
const MAX_TIMEOUT_MS = 30000
const MAX_TEXT = 240
const MAX_EVENTS = 80

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max */
export function clampInt(value, fallback, min, max) {
  if (value === null || value === undefined || value === '') return fallback
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** @param {unknown} value @param {number} fallback */
function clampNumber(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** 限制字符串长度，去掉控制字符，避免把远端内容原样灌进 UI / 日志。 */
export function cleanText(value, max = MAX_TEXT) {
  if (typeof value !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return stripped.length > max ? `${stripped.slice(0, max)}…` : stripped
}

/** 只保留 JSON 安全的数字 / 字符串 / 布尔 / 数组 / 纯对象。 */
export function jsonSafe(value, depth = 0) {
  if (depth > 4) return null
  if (value === null) return null
  const kind = typeof value
  if (kind === 'string') return cleanText(value)
  if (kind === 'boolean') return value
  if (kind === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => jsonSafe(item, depth + 1))
  if (kind === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {}
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(key)) continue
      out[key] = jsonSafe(item, depth + 1)
    }
    return out
  }
  return null
}

/** @param {number | null | undefined} value */
function percent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10))
}

/* ------------------------------------------------------------------ */
/* 令牌                                                                */
/* ------------------------------------------------------------------ */

/** 生成 48 位十六进制令牌（服务端保存，永不下发给浏览器）。 */
export function generateAgentToken() {
  const bytes = new Uint8Array(24)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 常量时间比较，避免通过响应时间猜测令牌。
 * 长度不同也先做一次摘要比较，不提前 return。
 */
export function compareTokens(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const a = createHash('sha256').update(left, 'utf8').digest()
  const b = createHash('sha256').update(right, 'utf8').digest()
  /* timingSafeEqual 需要同长度；两个摘要始终 32 字节。 */
  const equal = timingSafeEqual(a, b)
  return equal && left.length === right.length && left.length > 0
}

/* ------------------------------------------------------------------ */
/* 节点输入校验                                                        */
/* ------------------------------------------------------------------ */

/** @typedef {{ ok: true, value: any } | { ok: false, error: { code: string, message: string } }} Result */

/** @param {string} code @param {string} message @returns {Result} */
export function fail(code, message) {
  return { ok: false, error: { code, message } }
}

/** @param {any} value @returns {Result} */
export function ok(value) {
  return { ok: true, value }
}

/**
 * 归一化被监控节点的基地址：
 * - 只允许 http/https；
 * - 拒绝 URL 内嵌凭据（user:pass@host）、查询串与哈希（令牌走请求头）；
 * - 保留可选子路径，去掉末尾斜杠，方便反向代理 / 子路径部署。
 */
export function normalizeBaseUrl(raw) {
  if (typeof raw !== 'string') return fail('invalid-url', 'baseUrl 必须是字符串')
  const text = raw.trim()
  if (!text) return fail('invalid-url', 'baseUrl 不能为空')
  if (text.length > 500) return fail('invalid-url', 'baseUrl 过长')
  let url
  try {
    url = new URL(text)
  } catch {
    return fail('invalid-url', 'baseUrl 不是合法的 URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return fail('invalid-url', 'baseUrl 只支持 http / https')
  }
  if (url.username || url.password) return fail('invalid-url', 'baseUrl 不能内嵌账号或密码')
  if (url.search) return fail('invalid-url', 'baseUrl 不能带查询串')
  if (url.hash) return fail('invalid-url', 'baseUrl 不能带片段')
  const path = url.pathname.replace(/\/+$/, '')
  const baseUrl = `${url.origin}${path}`
  return ok({ baseUrl, origin: url.origin, pathname: path })
}

/** 把任意输入拼成请求 URL（避免双斜杠 / 失去子路径）。 */
export function joinUrl(baseUrl, path) {
  const base = String(baseUrl).replace(/\/+$/, '')
  const suffix = String(path).startsWith('/') ? path : `/${path}`
  return `${base}${suffix}`
}

/**
 * 校验新增 / 编辑节点的入参。token 可为空（generic 探测可能不需要认证），
 * 但绝不参与返回的 Node 记录。
 */
export function validateNodeInput(input, options = {}) {
  const { isUpdate = false } = options
  if (!input || typeof input !== 'object') return fail('invalid-input', '节点参数必须是对象')
  const source = /** @type {Record<string, unknown>} */ (input)

  // 名称可选：留空时由宿主探测远端 hostname 自动补全（见 index.js resolveNodeName）。
  const name = cleanText(source.name, 64)

  const urlResult = normalizeBaseUrl(source.baseUrl)
  if (!urlResult.ok) return urlResult
  const { baseUrl } = urlResult.value

  const adapter = typeof source.adapter === 'string' ? source.adapter : 'dsh'
  if (!ADAPTERS.includes(adapter)) return fail('invalid-adapter', `不支持的适配器：${adapter}`)

  /** @type {string | null} */
  let path = null
  if (adapter === 'generic') {
    const rawPath = typeof source.path === 'string' && source.path.trim() ? source.path.trim() : '/health'
    if (!rawPath.startsWith('/') || rawPath.length > 200 || /\s/.test(rawPath)) {
      return fail('invalid-path', 'generic 适配器的 path 必须以 / 开头且不能包含空白')
    }
    path = rawPath
  }

  const tags = Array.isArray(source.tags)
    ? source.tags
        .map((tag) => cleanText(tag, 24))
        .filter(Boolean)
        .slice(0, 6)
    : []

  let token = null
  if (typeof source.token === 'string' && source.token.trim()) token = source.token.trim()

  const enabled = source.enabled === undefined ? true : source.enabled === true

  const network = NETWORKS.includes(source.network) ? source.network : 'lan'
  const notes = cleanText(source.notes, 120)

  if (!isUpdate && adapter === 'dsh' && !token) {
    // 可以保存，但 dsh 探测必然 401；这里只做提示，不阻止用户先建节点。
    // 提示由宿主在 probe 错误码 auth 中给出。
  }

  return ok({ name, baseUrl, adapter, path, tags, token, enabled, network, notes })
}

/* ------------------------------------------------------------------ */
/* 双向配对（A 添加 B 后，B 也自动登记 A）                              */
/* ------------------------------------------------------------------ */

/**
 * @param {unknown} input
 * @returns {{ok:true,value:{port:number,label:string,id:string,token:string}}|{ok:false,error:{code:string,message:string}}}
 */
export function validatePairRequest(input) {
  if (!input || typeof input !== 'object') return fail('invalid-input', '配对参数必须是对象')
  const source = /** @type {Record<string, unknown>} */ (input)
  const port = clampInt(source.port, 0, 1, 65535)
  if (!port) return fail('invalid-port', '端口无效')
  const token = typeof source.token === 'string' ? source.token.trim() : ''
  if (token.length < 8 || token.length > 200) return fail('invalid-token', '连接令牌无效')
  return ok({
    port,
    label: cleanText(source.label, 64),
    id: cleanText(source.id, 64),
    token,
    agentPort: clampInt(source.agentPort, 0, 1, 65535) || 0
  })
}

/* ------------------------------------------------------------------ */
/* 登录材料（Hub 模式：一键打开远端 DSH）                                */
/* ------------------------------------------------------------------ */

/**
 * 解析用户粘贴的 DSH 登录地址（通常是启动时打印的 `...?token=...`）。
 * 只在宿主持有明文，返回给面板的只有掩码信息。
 */
export function parseLoginUrl(raw) {
  if (typeof raw !== 'string') return fail('login-url-invalid', '登录地址必须是字符串')
  const text = raw.trim()
  if (!text) return fail('login-url-invalid', '登录地址不能为空')
  if (text.length > LOGIN_URL_MAX) return fail('login-url-invalid', '登录地址过长')
  let url
  try {
    url = new URL(text)
  } catch {
    return fail('login-url-invalid', '登录地址不是合法的 URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return fail('login-url-invalid', '登录地址只支持 http / https')
  }
  if (!url.hostname) return fail('login-url-invalid', '登录地址缺少主机名')
  const token = url.searchParams.get('token') || url.searchParams.get('access_token') || ''
  return ok({
    url: url.toString(),
    origin: url.origin,
    host: url.host,
    pathname: url.pathname,
    hasToken: Boolean(token)
  })
}

/** 面板可见的登录材料摘要（永不包含 URL / token）。 */
export function maskLogin(login) {
  if (!login || typeof login !== 'object') return { configured: false, host: '', hasToken: false }
  const parsed = parseLoginUrl(login.url)
  if (!parsed.ok) return { configured: false, host: '', hasToken: false }
  return { configured: true, host: parsed.value.host, hasToken: parsed.value.hasToken }
}

/**
 * 校验节点侧运维请求。默认 dryRun=true；`plugins.setEnabled` 真实执行需 confirm=true，
 * `restart` 还需节点配置 allowRestart。
 * @param {unknown} input
 * @param {{ allowRestart?: boolean }} [options]
 */
export const BATCH_OPS = /** @type {const} */ (['enable', 'disable', 'probe'])

/**
 * Validate one Hub-side batch request over the monitored node list.
 * @param {any} input
 * @returns {import('./core.js').Result}
 */
export function validateBatchRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('batch-invalid', '批量请求格式不正确')
  const op = typeof input.op === 'string' ? input.op : ''
  if (!BATCH_OPS.includes(op)) return fail('batch-op-invalid', '未知的批量动作')
  const raw = Array.isArray(input.ids) ? input.ids : []
  const ids = []
  for (const value of raw) {
    const id = cleanText(value, 80)
    if (id && !ids.includes(id)) ids.push(id)
    if (ids.length > 64) return fail('batch-too-many', '一次最多 64 个节点')
  }
  if (ids.length === 0) return fail('batch-empty', '请先选择节点')
  return ok({ op, ids })
}

const PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** 生成便于人工朗读/输入的配对令牌：XXXX-XXXX-XXXX（约 60 bit）。 */
export function generatePairingToken(groups = 3, size = 4) {
  const bytes = randomBytes(groups * size)
  const chars = []
  for (const byte of bytes) chars.push(PAIR_ALPHABET[byte % PAIR_ALPHABET.length])
  const out = []
  for (let index = 0; index < groups; index += 1) out.push(chars.slice(index * size, (index + 1) * size).join(''))
  return out.join('-')
}

export const DISCOVERY_PROTOCOL = 'dsh-node-monitor/discovery/1'
export const DISCOVERY_PORT = 45871
export const DISCOVERY_MULTICAST = '239.255.43.21'
export const DISCOVERY_TTL_MS = 5 * 60_000
export const DISCOVERY_MAX = 32

/** 把 UUID 形态的节点 id 压成 8 位大写短码，用于人工核对。 */
export function shortNodeId(value) {
  const id = cleanText(value, 64).replace(/-/g, '')
  return id ? id.slice(0, 8).toUpperCase() : ''
}

export function isLanAddress(address) {
  const text = cleanText(address, 64).toLowerCase()
  if (!text) return false
  if (text === '::1' || text.startsWith('127.')) return true
  if (text.startsWith('10.')) return true
  if (text.startsWith('192.168.')) return true
  if (text.startsWith('169.254.')) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(text)) return true
  if (text.startsWith('fc') || text.startsWith('fd') || text.startsWith('fe80')) return true
  return false
}

/**
 * 发现报文只包含「公开身份」：短 id、显示名、端口、版本。
 * 绝不包含令牌、会话或任何私有数据；发送方地址取自 UDP 报文来源，不信任载荷自称的地址。
 * @param {{ id: string, label: string, port: number, hostname: string, version: string, path?: string }} input
 */
export function buildAnnouncement(input) {
  const source = input && typeof input === 'object' ? input : {}
  return {
    m: DISCOVERY_PROTOCOL,
    v: 1,
    id: cleanText(source.id, 64),
    label: cleanText(source.label, 40) || 'DSH',
    port: clampInt(source.port, 3081, 1, 65535),
    host: cleanText(source.hostname, 64),
    version: cleanText(source.version, 24),
    ap: clampInt(source.agentPort, 0, 0, 65535) || 0,
    path: cleanText(source.path, 120) || '/',
    ts: Date.now()
  }
}

/**
 * 校验一条发现报文，返回可合并的条目（地址取 rinfo.address）。
 * @param {unknown} raw
 * @param {{ selfId?: string, address?: string, now?: number, ttlMs?: number }} [options]
 */
export function parseAnnouncement(raw, options = {}) {
  const selfId = cleanText(options.selfId, 64)
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const ttlMs = clampInt(options.ttlMs, DISCOVERY_TTL_MS, 1000, 3600_000)
  let data
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : Buffer.isBuffer(raw) ? JSON.parse(raw.toString('utf8')) : raw
  } catch {
    return fail('discovery-bad-json', '发现报文不是合法 JSON')
  }
  if (!data || typeof data !== 'object' || data.m !== DISCOVERY_PROTOCOL) return fail('discovery-bad-protocol', '发现报文协议不匹配')
  const id = cleanText(data.id, 64)
  if (!id || !/^[a-f0-9-]{8,64}$/i.test(id)) return fail('discovery-bad-id', '发现报文节点 id 不合法')
  if (selfId && id === selfId) return fail('discovery-self', '忽略来自自身的发现报文')
  const address = cleanText(options.address, 64)
  if (!isLanAddress(address)) return fail('discovery-bad-address', '发现报文来源地址不在局域网内')
  const ts = typeof data.ts === 'number' ? data.ts : now
  if (Math.abs(now - ts) > ttlMs) return fail('discovery-stale', '发现报文已过期')
  return ok({
    id,
    label: cleanText(data.label, 40) || 'DSH',
    address,
    port: clampInt(data.port, 3081, 1, 65535),
    hostname: cleanText(data.host, 64),
    version: cleanText(data.version, 24),
    agentPort: clampInt(data.ap, 0, 0, 65535) || 0,
    path: cleanText(data.path, 120) || '/',
    lastSeen: now
  })
}

/** 合并一条发现条目，按 id 去重、刷新 lastSeen、剔除过期项并限制上限。 */
export function mergeDiscovery(list, entry, now = Date.now()) {
  const items = Array.isArray(list) ? list.filter((item) => item && typeof item.id === 'string') : []
  const next = items.filter((item) => now - (Number(item.lastSeen) || 0) <= DISCOVERY_TTL_MS && item.id !== entry.id)
  next.unshift(entry)
  return next.slice(0, DISCOVERY_MAX)
}

/** 展示用地址：优先 http://<address>:<port><path>。 */
export function discoveryAddress(entry) {
  if (!entry || typeof entry !== 'object') return ''
  const host = cleanText(entry.address, 64)
  if (!host) return ''
  const port = clampInt(entry.port, 3081, 1, 65535)
  const path = cleanText(entry.path, 120) || '/'
  const hostPart = host.includes(':') ? `[${host}]` : host
  const base = `http://${hostPart}:${port}`
  return path === '/' ? base : `${base}${path.startsWith('/') ? path : `/${path}`}`
}

export function validateControlRequest(input, options = {}) {
  const source = input && typeof input === 'object' ? /** @type {Record<string, any>} */ (input) : {}
  const action = cleanText(source.action, 40)
  if (!CONTROL_ACTIONS.includes(action)) return fail('control-action-invalid', '未知的运维动作')
  const params = source.params && typeof source.params === 'object' ? source.params : {}
  const dryRun = source.dryRun !== false && action !== 'plugins.list' && action !== 'bundles.list'
  const confirm = source.confirm === true
  if (action === 'plugins.setEnabled') {
    const id = cleanText(params.id, 120)
    if (!id) return fail('control-param-invalid', '缺少插件 id')
    if (typeof params.enabled !== 'boolean') return fail('control-param-invalid', 'enabled 必须是布尔值')
    if (!dryRun && !confirm) return fail('control-confirm-required', '真实执行需要 confirm:true')
    return ok({ action, dryRun, confirm, params: { id, enabled: params.enabled } })
  }
  if (action === 'restart') {
    if (options.allowRestart !== true) return fail('control-restart-disabled', '节点未允许重启')
    if (!confirm) return fail('control-confirm-required', '重启需要 confirm:true')
    return ok({ action, dryRun: false, confirm: true, params: {} })
  }
  return ok({ action, dryRun, confirm, params: {} })
}


/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

/** 合并并夹取设置（RPC 输入一律不可信）。 */
export function clampSettings(input, base = DEFAULT_SETTINGS) {
  const source = input && typeof input === 'object' ? /** @type {Record<string, unknown>} */ (input) : {}
  return {
    refreshMs: clampInt(source.refreshMs, base.refreshMs, MIN_REFRESH_MS, MAX_REFRESH_MS),
    timeoutMs: clampInt(source.timeoutMs, base.timeoutMs, 800, MAX_TIMEOUT_MS),
    offlineAfterFailures: clampInt(source.offlineAfterFailures, base.offlineAfterFailures, 1, 10),
    latencyWarnMs: clampInt(source.latencyWarnMs, base.latencyWarnMs, 100, 60000),
    cpuWarnPct: clampInt(source.cpuWarnPct, base.cpuWarnPct, 30, 100),
    memWarnPct: clampInt(source.memWarnPct, base.memWarnPct, 30, 100),
    diskWarnFreePct: clampInt(source.diskWarnFreePct, base.diskWarnFreePct, 1, 90),
    eventsLimit: clampInt(source.eventsLimit, base.eventsLimit, 5, MAX_EVENTS)
  }
}

/* ------------------------------------------------------------------ */
/* 快照                                                                */
/* ------------------------------------------------------------------ */

/** 空快照（节点未上报时前端也能稳定渲染）。 */
export function emptySnapshot() {
  return {
    protocol: PROTOCOL,
    generatedAt: null,
    host: { hostname: '', platform: '', arch: '', version: '', uptimeSec: null },
    sessions: { total: null, running: null, idle: null, list: [] },
    control: { enabled: false, restart: false, actions: [] },
    metrics: {
      cpuPct: null,
      memPct: null,
      memUsedBytes: null,
      memTotalBytes: null,
      diskFreePct: null,
      diskFreeBytes: null,
      diskTotalBytes: null,
      load1: null
    },
    alerts: [],
    recent: []
  }
}

/** @param {unknown} value @param {number} max */
function finiteOrNull(value) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** @param {unknown} value */
function positiveOrNull(value) {
  const n = finiteOrNull(value)
  return n !== null && n >= 0 ? n : null
}

/** 统一把原始测量值整理成快照指标。 */
export function formatMetrics(raw = {}) {
  const memUsed = positiveOrNull(raw.memUsedBytes)
  const memTotal = positiveOrNull(raw.memTotalBytes)
  const diskFree = positiveOrNull(raw.diskFreeBytes)
  const diskTotal = positiveOrNull(raw.diskTotalBytes)
  return {
    cpuPct: percent(finiteOrNull(raw.cpuPct)),
    memPct: percent(
      finiteOrNull(raw.memPct) ?? (memUsed !== null && memTotal ? (memUsed / memTotal) * 100 : null)
    ),
    memUsedBytes: memUsed,
    memTotalBytes: memTotal,
    diskFreePct: percent(
      finiteOrNull(raw.diskFreePct) ?? (diskFree !== null && diskTotal ? (diskFree / diskTotal) * 100 : null)
    ),
    diskFreeBytes: diskFree,
    diskTotalBytes: diskTotal,
    load1: finiteOrNull(raw.load1)
  }
}

/**
 * 清洗远端 dsh 适配器上报的快照。
 * 所有字段重新塑造，未知字段不会透传到浏览器。
 */
/**
 * 只读会话概览：仅暴露路由与会话元数据（id/状态/模型/工作目录/时间），
 * 不包含对话内容、提示词、工具参数或文件路径之外的任何正文。
 * @param {unknown} value
 * @returns {Array<{id:string,title:string,status:string,model:string,cwd:string,createdAt:string,lastAt:string,parentId:string,depth:number|null,seeded:boolean}>}
 */
export function sanitizeSessionList(value) {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, 20)
    .map((item) => ({
      id: cleanText(item?.id, 64),
      title: cleanText(item?.title, 80),
      status: item?.status === 'running' ? 'running' : 'idle',
      model: cleanText(item?.model, 80),
      cwd: cleanText(item?.cwd, 160),
      createdAt: cleanText(item?.createdAt, 40),
      lastAt: cleanText(item?.lastAt, 40),
      parentId: cleanText(item?.parentId, 64),
      depth: positiveOrNull(item?.depth),
      seeded: Boolean(item?.seeded)
    }))
    .filter((item) => Boolean(item.id))
}

export function sanitizeSnapshot(payload) {
  const source = payload && typeof payload === 'object' ? /** @type {Record<string, any>} */ (payload) : {}
  const host = source.host && typeof source.host === 'object' ? source.host : {}
  const sessions = source.sessions && typeof source.sessions === 'object' ? source.sessions : {}
  const metrics = source.metrics && typeof source.metrics === 'object' ? source.metrics : {}
  const alerts = Array.isArray(source.alerts) ? source.alerts.slice(0, 20) : []
  const recent = Array.isArray(source.recent) ? source.recent.slice(0, 20) : []

  return {
    protocol: PROTOCOL,
    generatedAt: typeof source.generatedAt === 'string' ? cleanText(source.generatedAt, 40) : null,
    host: {
      hostname: cleanText(host.hostname, 80),
      platform: cleanText(host.platform, 40),
      arch: cleanText(host.arch, 40),
      version: cleanText(host.version, 40),
      uptimeSec: positiveOrNull(host.uptimeSec)
    },
    sessions: {
      total: positiveOrNull(sessions.total),
      running: positiveOrNull(sessions.running),
      idle: positiveOrNull(sessions.idle),
      list: sanitizeSessionList(sessions.list)
    },
    control: {
      enabled: source.control?.enabled === true,
      restart: source.control?.restart === true,
      actions: Array.isArray(source.control?.actions)
        ? source.control.actions.map((action) => cleanText(action, 40)).filter((action) => CONTROL_ACTIONS.includes(action)).slice(0, 8)
        : []
    },
    metrics: formatMetrics(metrics),
    alerts: alerts
      .map((alert) => ({
        code: cleanText(alert?.code, 60),
        severity: SEVERITIES.includes(alert?.severity) ? alert.severity : 'info',
        params: jsonSafe(alert?.params ?? {}) || {}
      }))
      .filter((alert) => Boolean(alert.code)),
    recent: recent
      .map((event) => ({
        at: cleanText(event?.at, 40),
        kind: cleanText(event?.kind, 40),
        code: cleanText(event?.code, 60),
        params: jsonSafe(event?.params ?? {}) || {},
        text: cleanText(event?.text, 180)
      }))
      .filter((event) => Boolean(event.code || event.text))
  }
}

/**
 * 只读令牌（自动配对/局域网发现）能看到的快照。
 *
 * 会话标题、工作目录和最近事件里可能包含会话 ID、项目路径等元数据，
 * 只读令牌只用于「看板级」状态，因此这里把明细字段清空，只保留计数与指标。
 * @param {any} payload
 */
export function restrictSnapshot(payload) {
  const snapshot = payload && typeof payload === 'object' ? { ...payload } : {}
  const sessions = snapshot.sessions && typeof snapshot.sessions === 'object' ? snapshot.sessions : {}
  snapshot.sessions = {
    total: positiveOrNull(sessions.total),
    running: positiveOrNull(sessions.running),
    idle: positiveOrNull(sessions.idle),
    list: []
  }
  snapshot.control = { enabled: false, restart: false, actions: [] }
  snapshot.recent = []
  return snapshot
}

/**
 * dsh 适配器应答校验。
 * 协议不匹配时仍然保留可用字段（降级显示），但返回 protocolMismatch 供告警使用。
 */
export function adaptAgentStatus(payload, expectedProtocol = PROTOCOL) {
  if (!payload || typeof payload !== 'object') return fail('bad-json', '节点返回的不是 JSON 对象')
  const protocol = typeof payload.protocol === 'string' ? payload.protocol : ''
  if (!protocol) return fail('protocol-missing', '节点未声明 protocol 字段')
  const value = sanitizeSnapshot(payload)
  value.protocol = protocol
  return ok({ snapshot: value, protocolMismatch: protocol !== expectedProtocol, remoteProtocol: protocol })
}

/**
 * generic 适配器：接受最小健康契约
 * `{ ok?: boolean, status?: 'ok'|'degraded'|'error', metrics?: {...}, sessions?: {...} }`。
 */
export function adaptGenericStatus(payload) {
  if (!payload || typeof payload !== 'object') return fail('bad-json', '节点返回的不是 JSON 对象')
  const okFlag = payload.ok !== false
  const status = typeof payload.status === 'string' ? payload.status : ''
  if (!okFlag || status === 'error' || status === 'down') {
    return fail('remote-unhealthy', '节点标记自身为不健康状态')
  }
  const value = sanitizeSnapshot({
    protocol: 'generic',
    generatedAt: typeof payload.generatedAt === 'string' ? payload.generatedAt : null,
    host: payload.host,
    sessions: payload.sessions,
    metrics: payload.metrics,
    alerts: payload.alerts,
    recent: payload.recent
  })
  return ok({ snapshot: value, protocolMismatch: false, remoteProtocol: 'generic' })
}

/* ------------------------------------------------------------------ */
/* 探测                                                                */
/* ------------------------------------------------------------------ */

/**
 * 对不同适配器生成探测请求。
 * @param {{ adapter: string, baseUrl: string, path?: string | null }} node
 */
export function probeTarget(node) {
  if (node.adapter === 'generic') {
    return joinUrl(node.baseUrl, node.path || '/health')
  }
  return joinUrl(node.baseUrl, AGENT_STATUS_PATH)
}

/** @typedef {{ ok: true, probe: ProbeResult } | { ok: false, probe: ProbeResult }} ProbeOutcome */
/**
 * @typedef {{
 *   status: 'ok' | 'error',
 *   latencyMs: number,
 *   checkedAt: string,
 *   error: null | { code: string, message: string },
 *   snapshot: null | ReturnType<typeof emptySnapshot>,
 *   protocolMismatch?: boolean,
 *   remoteProtocol?: string
 * }} ProbeResult
 */

/** @param {string} code @param {string} message */
function probeError(code, message) {
  return { status: /** @type {'error'} */ ('error'), error: { code, message } }
}

/**
 * 一次 HTTP 探测。`fetchImpl` 可注入，便于测试；默认使用全局 fetch。
 * 不修改任何状态，不写日志。
 *
 * 错误码：
 *   timeout / unreachable / auth / not-found / http-status / bad-json /
 *   protocol-missing / remote-unhealthy / unknown
 */
export async function probeEndpoint(options) {
  const {
    node,
    token = '',
    timeoutMs = DEFAULT_SETTINGS.timeoutMs,
    fetchImpl = globalThis.fetch,
    expectedProtocol = PROTOCOL
  } = options

  const url = probeTarget(node)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()
  /** @type {ProbeResult} */
  const base = { status: 'ok', latencyMs: 0, checkedAt: new Date().toISOString(), error: null, snapshot: null }

  try {
    /** @type {Record<string, string>} */
    const headers = { accept: 'application/json', 'cache-control': 'no-store' }
    if (token) headers.authorization = `Bearer ${token}`
    const response = await fetchImpl(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
      redirect: 'error',
      cache: 'no-store'
    })
    base.latencyMs = Date.now() - startedAt

    if (response.status === 401 || response.status === 403) {
      return { ok: false, probe: { ...base, status: 'error', ...probeError('auth', '认证失败（令牌未配置、错误或已轮换）') } }
    }
    if (response.status === 404) {
      return { ok: false, probe: { ...base, status: 'error', ...probeError('not-found', '节点地址可达，但未找到监控端点') } }
    }
    if (!response.ok) {
      return {
        ok: false,
        probe: { ...base, status: 'error', ...probeError('http-status', `节点返回 HTTP ${response.status}`) }
      }
    }

    const text = await response.text()
    if (text.length > 512 * 1024) {
      return { ok: false, probe: { ...base, status: 'error', ...probeError('bad-json', '节点响应过大，已拒绝') } }
    }
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      return { ok: false, probe: { ...base, status: 'error', ...probeError('bad-json', '节点返回的不是合法 JSON') } }
    }

    const adapted = node.adapter === 'generic' ? adaptGenericStatus(payload) : adaptAgentStatus(payload, expectedProtocol)
    if (!adapted.ok) {
      return { ok: false, probe: { ...base, status: 'error', ...probeError(adapted.error.code, adapted.error.message) } }
    }
    return {
      ok: true,
      probe: {
        ...base,
        status: 'ok',
        snapshot: adapted.value.snapshot,
        protocolMismatch: adapted.value.protocolMismatch,
        remoteProtocol: adapted.value.remoteProtocol
      }
    }
  } catch (error) {
    base.latencyMs = Date.now() - startedAt
    if (controller.signal.aborted) {
      return { ok: false, probe: { ...base, status: 'error', ...probeError('timeout', `探测超时（>${timeoutMs}ms）`) } }
    }
    return { ok: false, probe: { ...base, status: 'error', ...probeError('unreachable', '无法连接节点，请检查地址、端口与网络') } }
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ */
/* 状态与告警                                                          */
/* ------------------------------------------------------------------ */

/** @typedef {{ status: 'ok'|'error'|null, checkedAt: string|null, latencyMs: number|null, failures: number, error: {code:string,message:string}|null, snapshot: any, protocolMismatch?: boolean }} ProbeRecord */

/** 由探测记录推导展示状态。 */
export function classifyProbe(probe, settings = DEFAULT_SETTINGS) {
  if (!probe || !probe.checkedAt) return 'unknown'
  if (probe.status === 'ok') return 'online'
  return probe.failures >= (settings.offlineAfterFailures ?? 2) ? 'offline' : 'degraded'
}

/** @param {number | null | undefined} value */
function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * 基于节点配置、探测记录与阈值推导告警。
 * 返回稳定的 key（`<nodeId>:<code>`），前端据此确认。
 */
export function computeAlerts(context) {
  const { nodes, probes, settings, previous = [], now = new Date().toISOString() } = context
  const prevByKey = new Map(previous.map((alert) => [alert.key, alert]))
  /** @type {Array<{key:string,nodeId:string,code:string,severity:string,params:Record<string,unknown>,since:string}>} */
  const alerts = []

  /** @param {any} node @param {string} code @param {string} severity @param {Record<string, unknown>} params */
  const push = (node, code, severity, params) => {
    const key = `${node.id}:${code}`
    alerts.push({ key, nodeId: node.id, code, severity, params, since: prevByKey.get(key)?.since ?? now })
  }

  for (const node of nodes) {
    if (!node.enabled) continue
    const probe = probes[node.id]
    const status = classifyProbe(probe, settings)
    if (!probe || !probe.checkedAt) continue

    if (status === 'offline') {
      push(node, 'node.offline', 'critical', {
        name: node.name,
        reason: probe.error?.code ?? 'unreachable',
        failures: probe.failures ?? 0
      })
    } else if (probe.status === 'error') {
      push(node, 'node.unstable', 'warning', { name: node.name, reason: probe.error?.code ?? 'unreachable' })
    } else if (probe.protocolMismatch) {
      push(node, 'node.protocol', 'warning', { name: node.name, protocol: probe.snapshot?.protocol ?? '' })
    }

    if (probe.status === 'ok' && isNum(probe.latencyMs) && probe.latencyMs > settings.latencyWarnMs) {
      push(node, 'node.latency', 'warning', { name: node.name, latencyMs: probe.latencyMs })
    }

    const snapshot = probe.snapshot
    if (probe.status === 'ok' && snapshot && snapshot.metrics) {
      const { cpuPct, memPct, diskFreePct } = snapshot.metrics
      if (isNum(cpuPct) && cpuPct >= settings.cpuWarnPct) {
        push(node, 'node.cpu', cpuPct >= 95 ? 'critical' : 'warning', { name: node.name, value: cpuPct })
      }
      if (isNum(memPct) && memPct >= settings.memWarnPct) {
        push(node, 'node.mem', memPct >= 97 ? 'critical' : 'warning', { name: node.name, value: memPct })
      }
      if (isNum(diskFreePct) && diskFreePct <= settings.diskWarnFreePct) {
        push(node, 'node.disk', diskFreePct <= 3 ? 'critical' : 'warning', { name: node.name, value: diskFreePct })
      }
      for (const alert of snapshot.alerts ?? []) {
        if (!alert?.code) continue
        push(node, `node.remote.${cleanText(alert.code, 40)}`, SEVERITIES.includes(alert.severity) ? alert.severity : 'info', {
          name: node.name,
          ...(jsonSafe(alert.params ?? {}) || {})
        })
      }
    }
  }

  return alerts
}

/** 汇总给徽标 / 顶部统计使用。 */
export function summarize(nodes, probes, alerts, settings = DEFAULT_SETTINGS) {
  const summary = {
    total: nodes.length,
    enabled: 0,
    online: 0,
    degraded: 0,
    offline: 0,
    unknown: 0,
    alertsOpen: 0,
    alertsCritical: 0
  }
  for (const node of nodes) {
    if (!node.enabled) continue
    summary.enabled += 1
    const status = classifyProbe(probes[node.id], settings)
    summary[status] += 1
  }
  for (const alert of alerts) {
    if (alert.acked) continue
    summary.alertsOpen += 1
    if (alert.severity === 'critical') summary.alertsCritical += 1
  }
  return summary
}

/** 事件环形缓冲：保留最近的宿主事件，供面板「最近活动」使用。 */
export function appendEvent(events, event, limit = 40) {
  const next = Array.isArray(events) ? events.slice() : []
  next.unshift(event)
  return next.slice(0, Math.max(1, limit))
}

/** 相对时间的简单序列化（客户端可自行格式化，这里用于事件去重）。 */
export function nowIso() {
  return new Date().toISOString()
}

/** 生成探测记录（不包含令牌）。 */
export function probeRecordFromOutcome(outcome, previous = null) {
  const checkedAt = outcome.probe.checkedAt ?? nowIso()
  const failed = outcome.probe.status !== 'ok'
  const previousFailures = failed ? previous?.failures ?? 0 : 0
  return {
    status: outcome.probe.status,
    checkedAt,
    latencyMs: outcome.probe.latencyMs ?? null,
    failures: failed ? previousFailures + 1 : 0,
    error: outcome.probe.error ?? null,
    snapshot: outcome.probe.snapshot ?? previous?.snapshot ?? null,
    protocolMismatch: outcome.probe.protocolMismatch === true
  }
}

/**
 * 生成需要持久化到磁盘的最小状态（不含任何令牌）。
 * 令牌由宿主单独保存，避免状态文件被转发 / 泄露。
 */
export function toPersistedState({ nodes, settings, acks, seededSelf = false, version = 1 }) {
  return {
    version,
    updatedAt: nowIso(),
    seededSelf,
    nodes: nodes.map((node) => ({
      id: node.id,
      name: node.name,
      baseUrl: node.baseUrl,
      adapter: node.adapter,
      path: node.path ?? null,
      tags: node.tags ?? [],
      enabled: node.enabled !== false,
      network: node.network ?? 'lan',
      notes: node.notes ?? '',
      createdAt: node.createdAt,
      updatedAt: node.updatedAt
    })),
    settings,
    acks
  }
}

/** 告警确认表使用 `<nodeId>:<code>` 作为 key，需要比 jsonSafe 更宽的字符集。 */
function sanitizeAckMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  /** @type {Record<string, string>} */
  const out = {}
  let count = 0
  for (const [key, item] of Object.entries(value)) {
    if (count >= 500) break
    if (!/^[a-zA-Z0-9_.:-]{1,160}$/.test(key)) continue
    if (typeof item !== 'string' || item.length > 40) continue
    out[key] = item
    count += 1
  }
  return out
}

/**
 * 从磁盘状态恢复节点：只保留已知字段，丢弃任何多余的密钥字段。
 */
export function fromPersistedState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const nodes = Array.isArray(source.nodes) ? source.nodes : []
  return {
    seededSelf: source.seededSelf === true,
    nodes: nodes
      .map((node) => {
        if (!node || typeof node !== 'object') return null
        const base = normalizeBaseUrl(node.baseUrl)
        if (!base.ok) return null
        return {
          id: cleanText(node.id, 64) || `n-${randomUUID().slice(0, 8)}`,
          name: cleanText(node.name, 64) || '未命名节点',
          baseUrl: base.value.baseUrl,
          adapter: ADAPTERS.includes(node.adapter) ? node.adapter : 'dsh',
          path: node.adapter === 'generic' && typeof node.path === 'string' ? node.path : null,
          tags: Array.isArray(node.tags) ? node.tags.map((tag) => cleanText(tag, 24)).filter(Boolean).slice(0, 6) : [],
          enabled: node.enabled !== false,
          network: NETWORKS.includes(node.network) ? node.network : 'lan',
          notes: cleanText(node.notes, 120),
          createdAt: cleanText(node.createdAt, 40) || nowIso(),
          updatedAt: cleanText(node.updatedAt, 40) || nowIso()
        }
      })
      .filter(Boolean),
    settings: clampSettings(source.settings ?? {}),
    acks: sanitizeAckMap(source.acks)
  }
}

export const JOIN_HASH = 'node-monitor-join'

/** Build a shareable join link. The token lives in the URL fragment, so it is never sent to any server. */
export function encodeJoinLink(origin, token) {
  const base = String(origin || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) return ''
  const value = cleanText(token, 200)
  if (value.length < 8) return ''
  return `${base}/#${JOIN_HASH}=${encodeURIComponent(value)}`
}

/** Parse a join link (or a bare token pasted by the user). */
export function parseJoinLink(input) {
  const raw = String(input || '').trim()
  if (!raw) return fail('join-link-invalid', '加入链接为空')
  let url
  try {
    url = new URL(raw)
  } catch {
    return fail('join-link-invalid', '加入链接格式不正确')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return fail('join-link-invalid', '加入链接必须是 http/https')
  const marker = `#${JOIN_HASH}=`
  if (!url.hash.startsWith(marker)) return fail('join-link-invalid', '链接里没有加入令牌')
  const token = decodeURIComponent(url.hash.slice(marker.length)).trim()
  if (token.length < 8 || token.length > 200) return fail('join-link-invalid', '令牌长度不正确')
  const base = `${url.origin}${url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')}`
  return ok({ origin: base, token })
}

export const ADD_HASH = 'node-monitor-add'

/** Shareable link that adds one node: carries its agent endpoint URL and token in the # fragment. */
export function encodeNodeLink(origin, address, token) {
  const base = String(origin || '').trim().replace(/\/+$/, '')
  const target = String(address || '').trim()
  const value = cleanText(token, 200)
  if (!/^https?:\/\//i.test(base)) return ''
  if (!/^https?:\/\//i.test(target) || value.length < 8) return ''
  const payload = Buffer.from(JSON.stringify({ v: 1, u: target, t: value })).toString('base64url')
  return `${base}/#${ADD_HASH}=${payload}`
}

export function parseNodeLink(input) {
  const raw = String(input || '').trim()
  if (!raw) return fail('node-link-invalid', '接入链接为空')
  let url
  try {
    url = new URL(raw)
  } catch {
    return fail('node-link-invalid', '接入链接格式不正确')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return fail('node-link-invalid', '接入链接必须是 http/https')
  const marker = `#${ADD_HASH}=`
  if (!url.hash.startsWith(marker)) return fail('node-link-invalid', '链接里没有节点地址')
  let payload
  try {
    payload = JSON.parse(Buffer.from(url.hash.slice(marker.length), 'base64url').toString('utf8'))
  } catch {
    return fail('node-link-invalid', '接入链接内容损坏')
  }
  if (!payload || payload.v !== 1) return fail('node-link-invalid', '接入链接版本不支持')
  const target = String(payload.u || '').trim()
  const token = String(payload.t || '').trim()
  if (!/^https?:\/\//i.test(target) || token.length < 8 || token.length > 200) return fail('node-link-invalid', '接入链接内容无效')
  return ok({ baseUrl: target, token })
}
