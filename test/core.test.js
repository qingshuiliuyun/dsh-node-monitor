import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BATCH_OPS,
  PROTOCOL,
  AGENT_STATUS_PATH,
  adaptAgentStatus,
  adaptGenericStatus,
  appendEvent,
  classifyProbe,
  clampSettings,
  compareTokens,
  computeAlerts,
  emptySnapshot,
  formatMetrics,
  fromPersistedState,
  generateAgentToken,
  jsonSafe,
  maskLogin,
  parseLoginUrl,
  normalizeBaseUrl,
  probeEndpoint,
  probeRecordFromOutcome,
  probeTarget,
  sanitizeSessionList,
  sanitizeSnapshot,
  summarize,
  toPersistedState,
  validateBatchRequest,
  validateControlRequest,
  validateNodeInput
} from '../lib/core.js'

const node = (overrides = {}) => ({
  id: 'n1',
  name: '测试节点',
  baseUrl: 'http://127.0.0.1:3081',
  adapter: 'dsh',
  path: null,
  tags: [],
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides
})

test('normalizeBaseUrl 只接受干净的 http/https 地址', () => {
  const ok = normalizeBaseUrl('https://node.example.com/')
  assert.equal(ok.ok, true)
  assert.equal(ok.value.baseUrl, 'https://node.example.com')
  assert.equal(ok.value.origin, 'https://node.example.com')

  assert.equal(normalizeBaseUrl('http://10.0.0.2:3081/base/').value.baseUrl, 'http://10.0.0.2:3081/base')
  assert.equal(normalizeBaseUrl('ftp://node.example.com').ok, false)
  assert.equal(normalizeBaseUrl('https://user:pass@node.example.com').ok, false)
  assert.equal(normalizeBaseUrl('https://node.example.com/?a=1').ok, false)
  assert.equal(normalizeBaseUrl('https://node.example.com/#x').ok, false)
  assert.equal(normalizeBaseUrl('').ok, false)
  assert.equal(normalizeBaseUrl(42).ok, false)
})

test('validateNodeInput 校验名称、适配器、generic 路径并清洗标签', () => {
  const good = validateNodeInput({
    name: '  云服务器  ',
    baseUrl: 'https://node.example.com',
    adapter: 'generic',
    path: '/healthz',
    tags: [' prod ', '', 'cn', 42],
    enabled: false,
    token: '  secret  '
  })
  assert.equal(good.ok, true)
  assert.equal(good.value.name, '云服务器')
  assert.equal(good.value.adapter, 'generic')
  assert.equal(good.value.path, '/healthz')
  assert.deepEqual(good.value.tags, ['prod', 'cn'])
  assert.equal(good.value.enabled, false)
  assert.equal(good.value.token, 'secret')

  assert.equal(validateNodeInput({ baseUrl: 'https://x.test' }).ok, false)
  assert.equal(validateNodeInput({ name: 'x', baseUrl: 'https://x.test', adapter: 'nope' }).ok, false)
  assert.equal(validateNodeInput({ name: 'x', baseUrl: 'https://x.test', adapter: 'generic', path: 'health' }).ok, false)
  assert.equal(validateNodeInput({ name: 'x', baseUrl: 'https://x.test', adapter: 'generic', path: '/a b' }).ok, false)
  assert.equal(validateNodeInput({ name: 'x', baseUrl: 'https://x.test' }).value.enabled, true)
})

test('令牌生成与恒时比较', () => {
  const first = generateAgentToken()
  const second = generateAgentToken()
  assert.match(first, /^[0-9a-f]{48}$/)
  assert.notEqual(first, second)
  assert.equal(compareTokens(first, first), true)
  assert.equal(compareTokens(first, second), false)
  assert.equal(compareTokens(first, undefined), false)
  assert.equal(compareTokens('', ''), false)
})

test('clampSettings 夹取所有阈值且非法输入回退默认值', () => {
  const clamped = clampSettings({ refreshMs: 1, timeoutMs: 999999, offlineAfterFailures: 0, latencyWarnMs: -5, cpuWarnPct: 12, memWarnPct: 140, diskWarnFreePct: 0, eventsLimit: 999 })
  assert.equal(clamped.refreshMs, 2000)
  assert.equal(clamped.timeoutMs, 30000)
  assert.equal(clamped.offlineAfterFailures, 1)
  assert.equal(clamped.latencyWarnMs, 100)
  assert.equal(clamped.cpuWarnPct, 30)
  assert.equal(clamped.memWarnPct, 100)
  assert.equal(clamped.diskWarnFreePct, 1)
  assert.equal(clamped.eventsLimit, 80)

  const fallback = clampSettings({ refreshMs: 'nope', cpuWarnPct: null })
  assert.equal(fallback.refreshMs, 5000)
  assert.equal(fallback.cpuWarnPct, 85)
})

test('formatMetrics 推导百分比并规整非法数字', () => {
  const metrics = formatMetrics({ cpuPct: 42.4, memUsedBytes: 512, memTotalBytes: 1024, diskFreeBytes: 10, diskTotalBytes: 100, load1: 0.5 })
  assert.equal(metrics.cpuPct, 42.4)
  assert.equal(metrics.memPct, 50)
  assert.equal(metrics.diskFreePct, 10)
  assert.equal(metrics.load1, 0.5)

  const empty = formatMetrics({ cpuPct: 'x', memUsedBytes: -1, memTotalBytes: 0 })
  assert.equal(empty.cpuPct, null)
  assert.equal(empty.memPct, null)
  assert.equal(empty.memUsedBytes, null)
})

test('sanitizeSnapshot 白名单清洗，未知字段不外泄', () => {
  const snapshot = sanitizeSnapshot({
    protocol: PROTOCOL,
    secret: 'must-not-leak',
    host: { hostname: 'box', uptimeSec: 12, evil: 1 },
    sessions: { total: 3, running: 1, idle: 2 },
    metrics: { cpuPct: 10, memPct: 200 },
    alerts: [{ code: 'gpu.hot', severity: 'warning', params: { temp: 90 } }, { code: '' }],
    recent: [{ at: '2026-01-01T00:00:00.000Z', code: 'agent.created', text: 'x' }, { nothing: true }]
  })
  assert.equal(snapshot.host.hostname, 'box')
  assert.equal(snapshot.host.evil, undefined)
  assert.equal(snapshot.secret, undefined)
  assert.equal(snapshot.metrics.memPct, 100)
  assert.equal(snapshot.sessions.total, 3)
  assert.equal(snapshot.alerts.length, 1)
  assert.equal(snapshot.alerts[0].code, 'gpu.hot')
  assert.equal(snapshot.recent.length, 1)
  assert.equal(snapshot.protocol, PROTOCOL)
})

test('adaptAgentStatus 处理协议缺失 / 版本不匹配 / 非法 JSON 结构', () => {
  const missing = adaptAgentStatus({ host: {} })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'protocol-missing')

  const bad = adaptAgentStatus('nope')
  assert.equal(bad.ok, false)
  assert.equal(bad.error.code, 'bad-json')

  const mismatch = adaptAgentStatus({ protocol: 'dsh.node-monitor/9', metrics: { cpuPct: 20 } })
  assert.equal(mismatch.ok, true)
  assert.equal(mismatch.value.protocolMismatch, true)
  assert.equal(mismatch.value.remoteProtocol, 'dsh.node-monitor/9')

  const good = adaptAgentStatus({ protocol: PROTOCOL, metrics: { cpuPct: 20 }, alerts: [{ code: 'x', severity: 'critical' }] })
  assert.equal(good.ok, true)
  assert.equal(good.value.protocolMismatch, false)
  assert.equal(good.value.snapshot.alerts[0].severity, 'critical')
})

test('adaptGenericStatus 支持最小健康契约', () => {
  assert.equal(adaptGenericStatus({ ok: true, metrics: { cpuPct: 1 } }).ok, true)
  assert.equal(adaptGenericStatus({ status: 'degraded' }).ok, true)
  assert.equal(adaptGenericStatus({ ok: false }).error.code, 'remote-unhealthy')
  assert.equal(adaptGenericStatus({ status: 'down' }).error.code, 'remote-unhealthy')
  assert.equal(adaptGenericStatus(null).error.code, 'bad-json')
})

test('probeTarget 按适配器选择端点', () => {
  assert.equal(probeTarget(node()), `http://127.0.0.1:3081${AGENT_STATUS_PATH}`)
  assert.equal(probeTarget(node({ adapter: 'generic', path: '/healthz' })), 'http://127.0.0.1:3081/healthz')
  assert.equal(probeTarget(node({ adapter: 'generic', path: null })), 'http://127.0.0.1:3081/health')
})

test('probeEndpoint 成功路径携带 Bearer 且不回传令牌', async () => {
  let seen
  const outcome = await probeEndpoint({
    node: node(),
    token: 'agent-secret',
    timeoutMs: 1000,
    fetchImpl: async (url, init) => {
      seen = { url, init }
      return new Response(JSON.stringify({ protocol: PROTOCOL, host: { hostname: 'node-a' }, metrics: { cpuPct: 12 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
  })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.probe.status, 'ok')
  assert.equal(outcome.probe.snapshot.host.hostname, 'node-a')
  assert.equal(seen.init.headers.authorization, 'Bearer agent-secret')
  assert.equal(JSON.stringify(outcome.probe).includes('agent-secret'), false)
})

test('probeEndpoint 把状态码映射成稳定错误码', async () => {
  const run = (status) =>
    probeEndpoint({ node: node(), token: 't', fetchImpl: async () => new Response('{}', { status }) })

  assert.equal((await run(401)).probe.error.code, 'auth')
  assert.equal((await run(403)).probe.error.code, 'auth')
  assert.equal((await run(404)).probe.error.code, 'not-found')
  assert.equal((await run(500)).probe.error.code, 'http-status')
})

test('probeEndpoint 处理非 JSON、网络异常与超时', async () => {
  const badJson = await probeEndpoint({ node: node(), fetchImpl: async () => new Response('<html>', { status: 200 }) })
  assert.equal(badJson.probe.error.code, 'bad-json')

  const unreachable = await probeEndpoint({
    node: node(),
    fetchImpl: async () => {
      throw new TypeError('fetch failed')
    }
  })
  assert.equal(unreachable.probe.error.code, 'unreachable')

  const timeout = await probeEndpoint({
    node: node(),
    timeoutMs: 10,
    fetchImpl: (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })
  })
  assert.equal(timeout.probe.error.code, 'timeout')
})

test('classifyProbe 依据失败次数判定离线', () => {
  assert.equal(classifyProbe(null), 'unknown')
  assert.equal(classifyProbe({ status: 'ok', checkedAt: 'now' }), 'online')
  assert.equal(classifyProbe({ status: 'error', checkedAt: 'now', failures: 1 }), 'degraded')
  assert.equal(classifyProbe({ status: 'error', checkedAt: 'now', failures: 2 }), 'offline')
  assert.equal(classifyProbe({ status: 'error', checkedAt: 'now', failures: 2 }, { offlineAfterFailures: 3 }), 'degraded')
})

test('probeRecordFromOutcome 累计失败并在成功时归零', () => {
  const failure = probeRecordFromOutcome({ ok: false, probe: { status: 'error', checkedAt: 't1', latencyMs: 5, error: { code: 'timeout', message: 'x' }, snapshot: null } })
  assert.equal(failure.failures, 1)
  assert.equal(failure.status, 'error')

  const second = probeRecordFromOutcome({ ok: false, probe: { status: 'error', checkedAt: 't2', latencyMs: 5, error: { code: 'timeout', message: 'x' }, snapshot: null } }, failure)
  assert.equal(second.failures, 2)

  const ok = probeRecordFromOutcome({ ok: true, probe: { status: 'ok', checkedAt: 't3', latencyMs: 3, error: null, snapshot: emptySnapshot() } }, second)
  assert.equal(ok.failures, 0)
  assert.equal(ok.status, 'ok')
})

test('computeAlerts 推导离线、延迟、资源与远端告警', () => {
  const settings = clampSettings({})
  const offline = computeAlerts({
    nodes: [node({ id: 'a' })],
    probes: { a: { status: 'error', checkedAt: 'now', failures: 2, error: { code: 'timeout' } } },
    settings,
    previous: []
  })
  assert.equal(offline.length, 1)
  assert.equal(offline[0].code, 'node.offline')
  assert.equal(offline[0].severity, 'critical')
  assert.equal(offline[0].key, 'a:node.offline')

  const resource = computeAlerts({
    nodes: [node({ id: 'b', adapter: 'generic' })],
    probes: {
      b: {
        status: 'ok',
        checkedAt: 'now',
        failures: 0,
        latencyMs: 9000,
        protocolMismatch: false,
        snapshot: {
          ...emptySnapshot(),
          metrics: { ...emptySnapshot().metrics, cpuPct: 96, memPct: 98, diskFreePct: 2 },
          alerts: [{ code: 'gpu.hot', severity: 'warning', params: { temp: 90 } }]
        }
      }
    },
    settings,
    previous: []
  })
  const codes = resource.map((alert) => alert.code).sort()
  assert.deepEqual(codes, ['node.cpu', 'node.disk', 'node.latency', 'node.mem', 'node.remote.gpu.hot'])
  assert.equal(resource.find((alert) => alert.code === 'node.cpu').severity, 'critical')
  assert.equal(resource.find((alert) => alert.code === 'node.disk').severity, 'critical')

  const acked = computeAlerts({
    nodes: [node({ id: 'a' })],
    probes: { a: { status: 'error', checkedAt: 'now', failures: 2, error: { code: 'timeout' } } },
    settings,
    previous: [{ key: 'a:node.offline', code: 'node.offline', since: '2026-01-01T00:00:00.000Z' }]
  })
  assert.equal(acked[0].since, '2026-01-01T00:00:00.000Z')

  const disabled = computeAlerts({ nodes: [node({ enabled: false })], probes: {}, settings, previous: [] })
  assert.equal(disabled.length, 0)
})

test('summarize 汇总状态且忽略已确认告警', () => {
  const nodes = [node({ id: 'a' }), node({ id: 'b' }), node({ id: 'c', enabled: false })]
  const probes = {
    a: { status: 'ok', checkedAt: 'now', failures: 0 },
    b: { status: 'error', checkedAt: 'now', failures: 2 }
  }
  const alerts = [
    { key: 'b:node.offline', nodeId: 'b', code: 'node.offline', severity: 'critical' },
    { key: 'a:node.latency', nodeId: 'a', code: 'node.latency', severity: 'warning', acked: true }
  ]
  const summary = summarize(nodes, probes, alerts, clampSettings({}))
  assert.equal(summary.total, 3)
  assert.equal(summary.enabled, 2)
  assert.equal(summary.online, 1)
  assert.equal(summary.offline, 1)
  assert.equal(summary.degraded, 0)
  assert.equal(summary.alertsOpen, 1)
  assert.equal(summary.alertsCritical, 1)
})

test('appendEvent 保留最新事件并截断', () => {
  let events = []
  for (let index = 0; index < 5; index += 1) {
    events = appendEvent(events, { code: `e${index}`, at: `t${index}` }, 3)
  }
  assert.equal(events.length, 3)
  assert.deepEqual(events.map((event) => event.code), ['e4', 'e3', 'e2'])
})

test('持久化状态不含令牌且可完整恢复', () => {
  const persisted = toPersistedState({
    nodes: [node({ path: null, tags: ['prod'], extra: 'drop-me' })],
    settings: clampSettings({ cpuWarnPct: 90 }),
    acks: { 'n1:node.cpu': '2026-01-01T00:00:00.000Z' },
    seededSelf: true
  })
  const raw = JSON.stringify(persisted)
  assert.equal(raw.includes('token'), false)
  assert.equal(raw.includes('secret'), false)
  assert.equal(persisted.nodes[0].extra, undefined)
  assert.equal(persisted.seededSelf, true)

  const restored = fromPersistedState(JSON.parse(raw))
  assert.equal(restored.seededSelf, true)
  assert.equal(restored.nodes.length, 1)
  assert.equal(restored.nodes[0].name, '测试节点')
  assert.equal(restored.settings.cpuWarnPct, 90)
  assert.equal(restored.acks['n1:node.cpu'] !== undefined, true)

  const dirty = fromPersistedState({
    nodes: [
      { id: 'x', name: 'ok', baseUrl: 'https://ok.test', token: 'leak', adapter: 'bogus' },
      { name: 'bad', baseUrl: 'ftp://nope' }
    ],
    settings: { refreshMs: 1 },
    acks: { token: 'x' }
  })
  assert.equal(dirty.nodes.length, 1)
  assert.equal(dirty.nodes[0].adapter, 'dsh')
  assert.equal(dirty.nodes[0].token, undefined)
  assert.equal(dirty.settings.refreshMs, 2000)
})

test('jsonSafe 允许 JSON 值并拒绝函数 / BigInt', () => {
  assert.deepEqual(jsonSafe({ a: 1, b: [true, null, 'x'] }), { a: 1, b: [true, null, 'x'] })
  assert.equal(jsonSafe({ fn: () => 1 }).fn, null)
  assert.equal(jsonSafe({ big: 10n }).big, null)
  assert.equal(jsonSafe(undefined), null)
  assert.equal(jsonSafe({ 'bad key!': 1 })['bad key!'], undefined)
})

test('parseLoginUrl 解析 token URL，maskLogin 永不回显明文', () => {
  const good = parseLoginUrl('https://node.example.com:8443/?token=abc123#frag')
  assert.equal(good.ok, true)
  assert.equal(good.value.host, 'node.example.com:8443')
  assert.equal(good.value.hasToken, true)
  assert.equal(good.value.origin, 'https://node.example.com:8443')

  const noToken = parseLoginUrl('http://127.0.0.1:3081/')
  assert.equal(noToken.ok, true)
  assert.equal(noToken.value.hasToken, false)

  const accessToken = parseLoginUrl('https://x.test/?access_token=zzz')
  assert.equal(accessToken.value.hasToken, true)

  for (const bad of ['', '   ', 'javascript:alert(1)', 'ftp://x.test', 'not a url', 'https://', '//x.test']) {
    const result = parseLoginUrl(bad)
    assert.equal(result.ok, false, `expected fail for ${JSON.stringify(bad)}`)
    assert.equal(result.error.code, 'login-url-invalid')
  }
  assert.equal(parseLoginUrl('http://x.test/' + 'a'.repeat(1600)).ok, false)

  const masked = maskLogin({ url: 'https://node.example.com/?token=secret' })
  assert.deepEqual(masked, { configured: true, host: 'node.example.com', hasToken: true })
  assert.equal(JSON.stringify(masked).includes('secret'), false)
  assert.deepEqual(maskLogin(null), { configured: false, host: '', hasToken: false })
  assert.deepEqual(maskLogin({ url: 'javascript:alert(1)' }), { configured: false, host: '', hasToken: false })
})

test('validateNodeInput 接受网络位置与备注，并在持久化中保留', () => {
  const input = validateNodeInput({ name: '云主机', baseUrl: 'https://n.test', network: 'tailscale', notes: ' 机房 A ' })
  assert.equal(input.ok, true)
  assert.equal(input.value.network, 'tailscale')
  assert.equal(input.value.notes, '机房 A')

  const fallback = validateNodeInput({ name: 'x', baseUrl: 'https://n.test', network: 'weird' })
  assert.equal(fallback.value.network, 'lan')
  assert.equal(fallback.value.notes, '')

  const persisted = toPersistedState({
    nodes: [node({ network: 'tunnel', notes: '备注' })],
    settings: undefined,
    acks: {},
    seededSelf: false
  })
  assert.equal(persisted.nodes[0].network, 'tunnel')
  assert.equal(persisted.nodes[0].notes, '备注')
  const restored = fromPersistedState(persisted)
  assert.equal(restored.nodes[0].network, 'tunnel')
  assert.equal(restored.nodes[0].notes, '备注')
  const legacy = fromPersistedState({ nodes: [{ ...node(), network: undefined, notes: undefined }] })
  assert.equal(legacy.nodes[0].network, 'lan')
  assert.equal(legacy.nodes[0].notes, '')
})

test('sanitizeSessionList 只保留会话元数据并限制数量', () => {
  const input = [
    { id: 'session-a', status: 'running', model: 'deepseek/flash', cwd: '/work/app', createdAt: '2026-11-12T01:00:00.000Z', lastAt: '2026-11-12T05:00:00.000Z', depth: 1, seeded: true, messages: [{ text: 'secret' }] },
    { id: 'session-b', status: 'idle', title: '修复登录', cwd: 'C:\\work\\x', parentId: 'session-a' },
    { id: '', status: 'running' },
    null
  ]
  const out = sanitizeSessionList(input)
  assert.equal(out.length, 2)
  assert.equal(out[0].id, 'session-a')
  assert.equal(out[0].status, 'running')
  assert.equal(out[0].depth, 1)
  assert.equal(out[0].seeded, true)
  assert.equal(JSON.stringify(out).includes('secret'), false)
  assert.equal(out[1].status, 'idle')
  assert.equal(out[1].title, '修复登录')
  assert.equal(out[1].parentId, 'session-a')
  assert.equal(sanitizeSessionList(undefined).length, 0)

  const many = Array.from({ length: 40 }, (_, i) => ({ id: `session-${i}` }))
  assert.equal(sanitizeSessionList(many).length, 20)
  assert.deepEqual(sanitizeSnapshot({ sessions: { total: 2, running: 1, idle: 1, list: input } }).sessions.list.length, 2)
  assert.deepEqual(emptySnapshot().sessions.list, [])
})

test('控制请求：动作白名单、干跑默认、confirm 与 allowRestart 门禁', () => {
  assert.equal(validateControlRequest({ action: 'nope' }).ok, false)
  assert.equal(validateControlRequest({ action: 'nope' }).error.code, 'control-action-invalid')

  const dry = validateControlRequest({ action: 'plugins.setEnabled', params: { id: 'voice', enabled: true } })
  assert.equal(dry.ok, true)
  assert.equal(dry.value.dryRun, true)

  const unconfirmed = validateControlRequest(
    { action: 'plugins.setEnabled', params: { id: 'voice', enabled: true }, dryRun: false },
  )
  assert.equal(unconfirmed.ok, false)
  assert.equal(unconfirmed.error.code, 'control-confirm-required')

  const real = validateControlRequest(
    { action: 'plugins.setEnabled', params: { id: 'voice', enabled: false }, dryRun: false, confirm: true },
  )
  assert.equal(real.ok, true)
  assert.equal(real.value.dryRun, false)

  assert.equal(validateControlRequest({ action: 'plugins.setEnabled', params: {} }).error.code, 'control-param-invalid')
  assert.equal(
    validateControlRequest({ action: 'plugins.setEnabled', params: { id: 'x', enabled: 'yes' } }).error.code,
    'control-param-invalid',
  )

  assert.equal(validateControlRequest({ action: 'restart', confirm: true }).error.code, 'control-restart-disabled')
  const restart = validateControlRequest({ action: 'restart', confirm: true }, { allowRestart: true })
  assert.equal(restart.ok, true)
  assert.equal(restart.value.action, 'restart')
})

test('批量请求：白名单、去重、上限与空选拒绝', () => {
  assert.deepEqual(BATCH_OPS, ['enable', 'disable', 'probe'])
  const okProbe = validateBatchRequest({ op: 'probe', ids: ['a', 'a', 'b', ' '] })
  assert.equal(okProbe.ok, true)
  assert.deepEqual(okProbe.value.ids, ['a', 'b'])

  assert.equal(validateBatchRequest(null).error.code, 'batch-invalid')
  assert.equal(validateBatchRequest({ op: 'delete', ids: ['a'] }).error.code, 'batch-op-invalid')
  assert.equal(validateBatchRequest({ op: 'probe', ids: [] }).error.code, 'batch-empty')
  assert.equal(validateBatchRequest({ op: 'probe', ids: [123, ''] }).error.code, 'batch-empty')
  const many = validateBatchRequest({ op: 'enable', ids: Array.from({ length: 65 }, (_, i) => `n${i}`) })
  assert.equal(many.error.code, 'batch-too-many')
  const trimmed = validateBatchRequest({ op: 'disable', ids: ['x'.repeat(200)] })
  assert.equal(trimmed.ok, true)
  assert.equal(trimmed.value.ids[0].length <= 81, true)
})
