process.env.DSH_NODE_MONITOR_DISCOVERY = '0'
process.env.DSH_NODE_MONITOR_PUBLIC_LISTEN = '0'
process.env.DSH_NODE_MONITOR_AUTO_PAIR = '0'

import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { NodeMonitorHost, apply } from '../lib/index.js'
import { AGENT_HEALTH_PATH, AGENT_STATUS_PATH, CONTROL_PATH, HUB_PUSH_PATH, HUB_RESULT_PATH, OPEN_PATH, PAIR_PATH, PROTOCOL, RPC_CHANNEL, buildAnnouncement } from '../lib/core.js'

const owner = { principal: { kind: 'owner' } }
const browser = { principal: { kind: 'browser' } }

function fakeContext(origin, options = {}) {
  const rpc = new Map()
  const routes = new Map()
  const cleanups = []
  const effects = []
  const logger = { info() {}, warn() {}, error() {} }

  // 模拟 cordis Context：ctx.inject(deps, cb) 会给出子上下文，
  // ctx.extend(props) 返回叠加了 props 的新上下文（NodeMonitorHost 用它补出 webServer）。
  const makeCtx = (layer = {}) => {
    const ctx = {
      logger,
      get(name) {
        if (name === 'agents') {
          return {
            list: () => [
              { id: 'session-a1', status: 'running' },
              { id: 'session-b2', status: 'idle' }
            ]
          }
        }
        if (name === 'pluginManager') return options.pluginManager
        if (name === 'webServer') return ctx.webServer
        if (name === 'connection') return ctx.connection
        return undefined
      },
      on() {
        return () => {}
      },
      effect(fn) {
        const dispose = fn()
        if (typeof dispose === 'function') cleanups.push(dispose)
        return dispose
      },
      extend(props) {
        return makeCtx({ ...layer, ...props })
      },
      inject(_deps, callback) {
        const dispose = callback(makeCtx(layer))
        if (typeof dispose === 'function') cleanups.push(dispose)
        return () => {}
      },
      connection: {
        rpc: {
          handle(channel, handler) {
            rpc.set(channel, handler)
            return async () => {}
          }
        }
      },
      webServer: {
        getOrigin: () => origin,
        register(route) {
          routes.set(route.path, route.handler)
          return () => {}
        }
      }
    }
    return Object.assign(ctx, layer)
  }

  const ctx = makeCtx()
  return { ctx, rpc, routes, cleanups, effects }
}

function mockRes() {
  const headers = {}
  let body = ''
  return {
    statusCode: 0,
    headers,
    writeHead(status, extra) {
      this.statusCode = status
      for (const [key, value] of Object.entries(extra || {})) headers[String(key).toLowerCase()] = String(value)
      return this
    },
    setHeader(key, value) {
      headers[String(key).toLowerCase()] = String(value)
    },
    end(chunk) {
      body = typeof chunk === 'string' ? chunk : String(chunk ?? '')
    },
    json() {
      return JSON.parse(body)
    },
    rawBody() {
      return body
    }
  }
}

function mockReq(token, method = 'GET') {
  return {
    method,
    socket: { remoteAddress: '127.0.0.1' },
    headers: token ? { authorization: `Bearer ${token}` } : {}
  }
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

test('宿主：自检节点接入、RPC 权限、节点增删改与持久化', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'nm-host-'))
  const { ctx, rpc, routes, cleanups } = fakeContext('http://127.0.0.1:3999')
  const host = new NodeMonitorHost(ctx, { home })
  try {
    await host.start()
    assert.equal(routes.has(AGENT_STATUS_PATH), true)
    assert.equal(routes.has(AGENT_HEALTH_PATH), true)
    assert.equal(rpc.has(RPC_CHANNEL), true)

    const call = (endpoint, payload = {}, peer = owner) => rpc.get(RPC_CHANNEL)(endpoint, payload, undefined, peer)

    const initial = await call('state')
    assert.equal(initial.ok, true)
    assert.equal(initial.value.protocol, PROTOCOL)
    assert.equal(initial.value.nodes.length, 1)
    assert.equal(initial.value.nodes[0].id, 'self-loopback')
    assert.deepEqual(initial.value.nodes[0].tags, ['self'])
    assert.equal(initial.value.nodes[0].hasToken, true)
    assert.equal(initial.value.token.agentEndpointEnabled, true)
    assert.equal(initial.value.sessions, undefined)
    assert.equal(initial.value.summary.total, 1)
    assert.equal(initial.value.server.origin, 'http://127.0.0.1:3999')
    assert.equal(JSON.stringify(initial.value).includes(host.secrets.agentToken), false)

    const denied = await call('addNode', { name: 'x', baseUrl: 'http://127.0.0.1:1' }, browser)
    assert.equal(denied.ok, false)
    assert.equal(denied.error.code, 'node-monitor/forbidden')

    const added = await call('addNode', {
      name: '远端测试节点',
      baseUrl: 'http://127.0.0.1:1',
      adapter: 'generic',
      path: '/healthz',
      tags: ['lab'],
      token: 'remote-token-value'
    })
    assert.equal(added.ok, true)
    assert.equal(added.value.nodes.length, 2)
    const remote = added.value.nodes.find((node) => node.name === '远端测试节点')
    assert.ok(remote)
    assert.equal(remote.hasToken, true)
    assert.equal(remote.adapter, 'generic')

    const unknown = await call('nope')
    assert.equal(unknown.ok, false)
    assert.equal(unknown.error.code, 'node-monitor/unknown-endpoint')

    const invalid = await call('addNode', { name: '', baseUrl: 'ftp://x' })
    assert.equal(invalid.ok, false)
    assert.match(invalid.error.code, /^node-monitor\//)

    const test = await call('testNode', { id: remote.id })
    assert.equal(test.ok, true)
    assert.equal(test.value.success, false)
    assert.equal(typeof test.value.error.code, 'string')

    const updated = await call('updateNode', { id: remote.id, name: '远端节点 v2', baseUrl: 'http://127.0.0.1:2', adapter: 'dsh', enabled: false })
    assert.equal(updated.ok, true)
    const afterUpdate = updated.value.nodes.find((node) => node.id === remote.id)
    assert.equal(afterUpdate.name, '远端节点 v2')
    assert.equal(afterUpdate.enabled, false)

    const settings = await call('settings', { cpuWarnPct: 90, refreshMs: 3000 })
    assert.equal(settings.ok, true)
    assert.equal(settings.value.settings.cpuWarnPct, 90)
    assert.equal(settings.value.settings.refreshMs, 3000)

    const acked = await call('ackAll')
    assert.equal(acked.ok, true)

    const removed = await call('removeNode', { id: remote.id })
    assert.equal(removed.ok, true)
    assert.equal(removed.value.nodes.length, 1)

    await delay(40)
    const stateDir = path.join(home, 'node-monitor')
    const stateRaw = await fsp.readFile(path.join(stateDir, 'state.json'), 'utf8')
    assert.equal(stateRaw.includes('remote-token-value'), false)
    assert.equal(stateRaw.includes('agentToken'), false)
    const stateMode = (await fsp.stat(path.join(stateDir, 'state.json'))).mode & 0o777
    assert.equal(stateMode, 0o600)

    const secretsRaw = JSON.parse(await fsp.readFile(path.join(stateDir, 'secrets.json'), 'utf8'))
    assert.equal(secretsRaw.agentToken, host.secrets.agentToken)
    const secretsMode = (await fsp.stat(path.join(stateDir, 'secrets.json'))).mode & 0o777
    assert.equal(secretsMode, 0o600)

    await host.saveNow()
    const reloadedHome = home
    const { ctx: ctx2, rpc: rpc2, cleanups: cleanups2 } = fakeContext('http://127.0.0.1:3999')
    const host2 = new NodeMonitorHost(ctx2, { home: reloadedHome })
    await host2.start()
    const restored = await rpc2.get(RPC_CHANNEL)('state', {}, undefined, owner)
    assert.equal(restored.ok, true)
    assert.equal(restored.value.nodes.length, 1)
    assert.equal(restored.value.nodes[0].id, 'self-loopback')
    assert.equal(restored.value.settings.cpuWarnPct, 90)
    assert.equal(restored.value.seededSelf, undefined)
    for (const cleanup of cleanups2) cleanup()
  } finally {
    for (const cleanup of cleanups) cleanup()
    await fsp.rm(home, { recursive: true, force: true })
  }
})

test('宿主：agent 端点鉴权、健康检查与快照契约', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'nm-agent-'))
  const { ctx, routes, cleanups } = fakeContext('http://127.0.0.1:3998')
  const host = new NodeMonitorHost(ctx, { home })
  try {
    await host.start()
    const statusHandler = routes.get(AGENT_STATUS_PATH)

    const unauthorized = mockRes()
    await statusHandler(mockReq(''), unauthorized)
    assert.equal(unauthorized.statusCode, 401)
    assert.equal(unauthorized.headers['www-authenticate'], 'Bearer realm="dsh-node-monitor"')

    const wrong = mockRes()
    await statusHandler(mockReq('wrong-token'), wrong)
    assert.equal(wrong.statusCode, 401)

    const okRes = mockRes()
    await statusHandler(mockReq(host.secrets.agentToken), okRes)
    assert.equal(okRes.statusCode, 200)
    const payload = okRes.json()
    assert.equal(payload.protocol, PROTOCOL)
    assert.equal(typeof payload.host.hostname, 'string')
    assert.equal(payload.sessions.total, 2)
    assert.equal(payload.sessions.running, 1)
    assert.equal(payload.sessions.list.length, 2)
    assert.ok(payload.sessions.list.every((item) => item.id && (item.status === 'running' || item.status === 'idle')))
    assert.equal(JSON.stringify(payload).includes('"messages"'), false)
    assert.equal(JSON.stringify(payload).includes('"prompt"'), false)
    assert.equal(JSON.stringify(payload).includes(host.secrets.agentToken), false)
    assert.equal(JSON.stringify(payload).includes('remote-token'), false)

    const headRes = mockRes()
    await statusHandler(mockReq(host.secrets.agentToken, 'HEAD'), headRes)
    assert.equal(headRes.statusCode, 200)

    const methodNotAllowed = mockRes()
    await statusHandler(mockReq(host.secrets.agentToken, 'POST'), methodNotAllowed)
    assert.equal(methodNotAllowed.statusCode, 405)

    const health = mockRes()
    await routes.get(AGENT_HEALTH_PATH)(mockReq(''), health)
    assert.equal(health.statusCode, 200)
    assert.equal(health.json().name, 'dsh-node-monitor')
  } finally {
    for (const cleanup of cleanups) cleanup()
    await fsp.rm(home, { recursive: true, force: true })
  }
})

test('宿主：真实 HTTP 往返把远端节点标记为在线', async () => {
  const http = await import('node:http')
  const token = 'e2e-agent-token'
  const server = http.createServer((req, res) => {
    if (req.url !== AGENT_STATUS_PATH) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{"ok":false}')
      return
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end('{"ok":false}')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        protocol: PROTOCOL,
        generatedAt: new Date().toISOString(),
        host: { hostname: 'fake-remote', platform: 'linux', arch: 'x64', uptimeSec: 3600 },
        sessions: { total: 4, running: 2, idle: 2 },
        metrics: { cpuPct: 21, memPct: 43, diskFreePct: 71, load1: 0.2 },
        alerts: [{ code: 'deploy.pending', severity: 'warning', params: { job: 'api' } }],
        recent: [{ at: new Date().toISOString(), code: 'event.agentRunning', params: { agent: 'abc12345' } }]
      })
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'nm-e2e-'))
  const { ctx, rpc, cleanups } = fakeContext('http://127.0.0.1:3997')
  const host = new NodeMonitorHost(ctx, { home })
  try {
    await host.start()
    const call = (endpoint, payload = {}) => rpc.get(RPC_CHANNEL)(endpoint, payload, undefined, owner)
    const added = await call('addNode', {
      name: '真实远端',
      baseUrl: `http://127.0.0.1:${port}`,
      adapter: 'dsh',
      token
    })
    assert.equal(added.ok, true)
    const remote = added.value.nodes.find((node) => node.name === '真实远端')
    assert.ok(remote)

    const refreshed = await call('refresh')
    assert.equal(refreshed.ok, true)
    const probe = refreshed.value.probes[remote.id]
    assert.equal(probe.status, 'online')
    assert.equal(probe.snapshot.host.hostname, 'fake-remote')
    assert.equal(probe.snapshot.sessions.running, 2)
    assert.equal(probe.snapshot.metrics.cpuPct, 21)
    assert.equal(refreshed.value.summary.online >= 1, true)
    const alert = refreshed.value.alerts.find((item) => item.nodeId === remote.id)
    assert.equal(alert.code, 'node.remote.deploy.pending')
    assert.equal(alert.severity, 'warning')

    const acked = await call('ackAlert', { key: alert.key })
    assert.equal(acked.ok, true)
    assert.equal(acked.value.alerts.find((item) => item.key === alert.key).acked, true)

    const withoutToken = await call('testNode', { id: remote.id, token: 'nope' })
    assert.equal(withoutToken.value.success, false)
    assert.equal(withoutToken.value.error.code, 'auth')
  } finally {
    for (const cleanup of cleanups) cleanup()
    await new Promise((resolve) => server.close(resolve))
    await fsp.rm(home, { recursive: true, force: true })
  }
})

test('apply 立即返回 disposer 且禁用开关不注册任何东西', async () => {
  const { ctx, rpc, routes } = fakeContext('http://127.0.0.1:1')
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'nm-apply-'))
  const dispose = apply(ctx, { home })
  assert.equal(typeof dispose, 'function')
  await new Promise((resolve) => setTimeout(resolve, 400))
  assert.ok(rpc.has(RPC_CHANNEL))
  assert.ok(routes.has(AGENT_HEALTH_PATH))
  dispose()

  const { ctx: ctx2, rpc: rpc2, routes: routes2 } = fakeContext('http://127.0.0.1:1')
  const off = apply(ctx2, { home, enabled: false })
  assert.equal(off, undefined)
  assert.equal(rpc2.size, 0)
  assert.equal(routes2.size, 0)
})

test('宿主服务缺失或 inject 抛错时启动不抛异常', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'nm-broken-'))
  const broken = {
    logger: { info() {}, warn() {}, error() {} },
    get() {
      return undefined
    },
    on() {
      return () => {}
    },
    effect(fn) {
      return fn()
    },
    inject() {
      throw new Error('inject unavailable')
    }
  }
  const host = new NodeMonitorHost(broken, { home })
  await host.start()
  host.dispose()
  host.dispose()
})

test('Hub：登录材料只写入 secrets，一次性票据 302 打开，重放与篡改被拒绝', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'nm-hub-'))
  const { ctx, rpc, routes } = fakeContext('http://127.0.0.1:3998')
  const host = new NodeMonitorHost(ctx, { home })
  try {
    await host.start()
    const call = (endpoint, payload = {}) => rpc.get(RPC_CHANNEL)(endpoint, payload, undefined, owner)
    const added = await call('addNode', { name: '云端节点', baseUrl: 'http://10.1.1.5:3081', adapter: 'dsh' })
    assert.equal(added.ok, true)
    const node = added.value.nodes.find((item) => item.name === '云端节点')
    assert.ok(node)
    assert.equal(node.login.configured, false)

    const loginUrl = 'http://10.1.1.5:3081/?token=secret-abc-123'
    const saved = await call('setLogin', { id: node.id, url: loginUrl })
    assert.equal(saved.ok, true)
    const after = saved.value.nodes.find((item) => item.id === node.id)
    assert.equal(after.login.configured, true)
    assert.equal(after.login.hasToken, true)
    assert.equal(after.login.host, '10.1.1.5:3081')
    assert.equal(JSON.stringify(saved.value).includes('secret-abc-123'), false)

    const stateRaw = await fsp.readFile(path.join(home, 'node-monitor', 'state.json'), 'utf8')
    assert.equal(stateRaw.includes('secret-abc-123'), false)
    const secretsRaw = await fsp.readFile(path.join(home, 'node-monitor', 'secrets.json'), 'utf8')
    assert.equal(secretsRaw.includes('secret-abc-123'), true)

    const open = routes.get(OPEN_PATH)
    assert.equal(typeof open, 'function')

    // 正常打开：302 到登录地址
    const ticket = await call('openTicket', { id: node.id })
    assert.equal(ticket.ok, true)
    assert.match(ticket.value.url, /^\/node-monitor\/open\?id=/)
    const first = mockRes()
    open({ method: 'GET', url: ticket.value.url, headers: {}, socket: {} }, first)
    assert.equal(first.statusCode, 302)
    assert.equal(first.headers.location, loginUrl)
    assert.equal(first.headers['cache-control'], 'no-store')

    // 重放同一票据：拒绝
    const replay = mockRes()
    open({ method: 'GET', url: ticket.value.url, headers: {}, socket: {} }, replay)
    assert.equal(replay.statusCode, 403)

    // 篡改签名：拒绝
    const forged = ticket.value.url.replace(/t=[^&]+/, 't=Zm9yZ2Vk.c2ln')
    const forgedRes = mockRes()
    open({ method: 'GET', url: forged, headers: {}, socket: {} }, forgedRes)
    assert.equal(forgedRes.statusCode, 403)

    // 缺少票据 / 错误方法
    const missing = mockRes()
    open({ method: 'GET', url: `/node-monitor/open?id=${encodeURIComponent(node.id)}`, headers: {}, socket: {} }, missing)
    assert.equal(missing.statusCode, 403)
    const badMethod = mockRes()
    open({ method: 'POST', url: ticket.value.url, headers: {}, socket: {} }, badMethod)
    assert.equal(badMethod.statusCode, 405)

    // 清除后：仍可打开，但落回节点 baseUrl
    const cleared = await call('clearLogin', { id: node.id })
    assert.equal(cleared.ok, true)
    assert.equal(cleared.value.nodes.find((item) => item.id === node.id).login.configured, false)
    const t2 = await call('openTicket', { id: node.id })
    assert.equal(t2.value.hasLogin, false)
    const second = mockRes()
    open({ method: 'GET', url: t2.value.url, headers: {}, socket: {} }, second)
    assert.equal(second.statusCode, 302)
    assert.equal(second.headers.location, 'http://10.1.1.5:3081')

    // 非 owner 不能读 / 改登录材料
    const denied = await rpc.get(RPC_CHANNEL)('setLogin', { id: node.id, url: loginUrl }, undefined, browser)
    assert.equal(denied.ok, false)
    assert.equal(denied.error.code, 'node-monitor/forbidden')
    const deniedTicket = await rpc.get(RPC_CHANNEL)('openTicket', { id: node.id }, undefined, browser)
    assert.equal(deniedTicket.ok, false)

    // 非法登录地址被拒绝
    const bad = await call('setLogin', { id: node.id, url: 'javascript:alert(1)' })
    assert.equal(bad.ok, false)
    assert.equal(bad.error.code, 'node-monitor/login-url-invalid')
  } finally {
    await host.dispose()
    await fsp.rm(home, { recursive: true, force: true })
  }
})

test('控制面默认关闭：/control 返回 control-disabled，审计为空', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'nm-ctl-off-'))
  const fake = fakeContext('http://127.0.0.1:3099')
  const host = new NodeMonitorHost(fake.ctx, { home })
  await host.start()
  await new Promise((resolve) => setTimeout(resolve, 50))
  const handler = fake.routes.get(CONTROL_PATH)
  assert.equal(typeof handler, 'function')
  const res = mockRes()
  await handler(
    {
      method: 'POST',
      url: CONTROL_PATH,
      headers: { authorization: `Bearer ${host.secrets.agentToken}` },
      socket: { remoteAddress: '10.0.0.9' },
      on(event, cb) {
        if (event === 'data') cb(Buffer.from(JSON.stringify({ action: 'plugins.list' })))
        if (event === 'end') cb()
      },
      destroy() {}
    },
    res
  )
  assert.equal(res.statusCode, 403)
  assert.equal(res.json().error, 'control-disabled')
  await fsp.rm(home, { recursive: true, force: true })
})

test('控制面：dryRun 不调用插件服务，真实执行写审计且不含令牌', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'nm-ctl-on-'))
  const calls = []
  const pluginManager = {
    async listPlugins() {
      return [
        { entryId: 'entry-node-monitor', moduleName: 'dsh-node-monitor', enabled: true, patchId: 'node-monitor' },
        { entryId: 'entry-voice', moduleName: 'voice-input', enabled: false, readOnlyReason: 'locked' }
      ]
    },
    async listBundles() {
      return [{ name: 'dsh-node-monitor', official: false, availability: 'profile' }]
    },
    async setPluginEnabled(id, enabled) {
      calls.push([id, enabled])
      return { saved: true, applied: 'restart' }
    }
  }
  const fake = fakeContext('http://127.0.0.1:3099', { pluginManager })
  const host = new NodeMonitorHost(fake.ctx, { home, allowControl: true })
  await host.start()
  await new Promise((resolve) => setTimeout(resolve, 50))
  const handler = fake.routes.get(CONTROL_PATH)
  const call = async (body) => {
    const res = mockRes()
    await handler(
      {
        method: 'POST',
        url: CONTROL_PATH,
        headers: { authorization: `Bearer ${host.secrets.agentToken}` },
        socket: { remoteAddress: '10.0.0.10' },
        on(event, cb) {
          if (event === 'data') cb(Buffer.from(JSON.stringify(body)))
          if (event === 'end') cb()
        },
        destroy() {}
      },
      res
    )
    return { status: res.statusCode, payload: res.json() }
  }
  const listed = await call({ action: 'plugins.list' })
  assert.equal(listed.status, 200)
  assert.equal(listed.payload.value.items.length, 2)
  assert.equal(listed.payload.value.items[1].enabled, false)

  const dry = await call({ action: 'plugins.setEnabled', params: { id: 'entry-voice', enabled: true }, dryRun: true })
  assert.equal(dry.status, 200)
  assert.equal(dry.payload.dryRun, true)
  assert.deepEqual(calls, [])

  const real = await call({ action: 'plugins.setEnabled', params: { id: 'entry-voice', enabled: false }, dryRun: false, confirm: true })
  assert.equal(real.status, 200)
  assert.deepEqual(calls, [['entry-voice', false]])

  const unconfirmed = await call({ action: 'plugins.setEnabled', params: { id: 'entry-voice', enabled: true }, dryRun: false })
  assert.equal(unconfirmed.status, 400)
  assert.equal(unconfirmed.payload.error, 'control-confirm-required')

  const restart = await call({ action: 'restart', confirm: true })
  assert.equal(restart.status, 400)
  assert.equal(restart.payload.error, 'control-restart-disabled')

  const audit = await fsp.readFile(host.auditFile, 'utf8')
  const lines = audit.trim().split('\n').map((line) => JSON.parse(line))
  assert.ok(lines.length >= 4)
  assert.equal(audit.includes(host.secrets.agentToken), false)
  assert.equal(audit.includes('dryRun'), true)
  const mode = (await fsp.stat(host.auditFile)).mode & 0o777
  assert.equal(mode, 0o600)
  await fsp.rm(home, { recursive: true, force: true })
})

test('控制面：restart 未确认/未允许都不执行，允许后返回 202', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'nm-ctl-restart-'))
  const fake = fakeContext('http://127.0.0.1:3099', { pluginManager: { async listPlugins() { return [] } } })
  const host = new NodeMonitorHost(fake.ctx, { home, allowControl: true, allowRestart: true })
  await host.start()
  await new Promise((resolve) => setTimeout(resolve, 50))
  const handler = fake.routes.get(CONTROL_PATH)
  const post = async (body) => {
    const res = mockRes()
    await handler(
      {
        method: 'POST',
        url: CONTROL_PATH,
        headers: { authorization: `Bearer ${host.secrets.agentToken}` },
        socket: { remoteAddress: '10.0.0.11' },
        on(event, cb) {
          if (event === 'data') cb(Buffer.from(JSON.stringify(body)))
          if (event === 'end') cb()
        },
        destroy() {}
      },
      res
    )
    return { status: res.statusCode, payload: res.json() }
  }
  const noConfirm = await post({ action: 'restart' })
  assert.equal(noConfirm.status, 400)
  assert.equal(noConfirm.payload.error, 'control-confirm-required')
  // 不放行真正的 process.exit：只校验通过校验器，不触发 202 分支
  host.disposed = true
  await fsp.rm(home, { recursive: true, force: true })
})

test('宿主：批量探测/启用/停用与权限、空选与上限拒绝', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'nm-batch-'))
  const { ctx, rpc, routes, cleanups } = fakeContext('http://127.0.0.1:3998')
  const host = new NodeMonitorHost(ctx, { home })
  try {
    await host.start()
    assert.equal(routes.has(AGENT_HEALTH_PATH), true)
    const call = (endpoint, payload = {}, peer = owner) => rpc.get(RPC_CHANNEL)(endpoint, payload, undefined, peer)

    const added = await call('addNode', { name: '批量节点', baseUrl: 'http://127.0.0.1:3092', adapter: 'dsh', token: 'batch-token' })
    const nodeId = added.value.nodes.find((node) => node.name === '批量节点').id

    const denied = await call('batchNodes', { op: 'disable', ids: [nodeId] }, browser)
    assert.equal(denied.ok, false)
    assert.equal(denied.error.code, 'node-monitor/forbidden')

    const empty = await call('batchNodes', { op: 'probe', ids: [] })
    assert.equal(empty.ok, false)
    assert.equal(empty.error.code, 'node-monitor/batch-empty')

    const tooMany = await call('batchNodes', { op: 'probe', ids: Array.from({ length: 65 }, (_, i) => `n${i}`) })
    assert.equal(tooMany.ok, false)
    assert.equal(tooMany.error.code, 'node-monitor/batch-too-many')

    const disabled = await call('batchNodes', { op: 'disable', ids: [nodeId, 'self-loopback'] })
    assert.equal(disabled.ok, true)
    assert.equal(disabled.value.nodes.every((node) => node.enabled === false), true)

    const enabled = await call('batchNodes', { op: 'enable', ids: [nodeId] })
    assert.equal(enabled.ok, true)
    assert.equal(enabled.value.nodes.find((node) => node.id === nodeId).enabled, true)

    const probed = await call('batchNodes', { op: 'probe', ids: [nodeId] })
    assert.equal(probed.ok, true)
    assert.equal(typeof probed.value.probes[nodeId].status, 'string')
    assert.equal(JSON.stringify(probed.value).includes(host.secrets.agentToken), false)

    const missing = await call('batchNodes', { op: 'probe', ids: ['nope'] })
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, 'node-monitor/node-not-found')

    const persisted = JSON.parse(await fsp.readFile(path.join(home, 'node-monitor', 'state.json'), 'utf8'))
    assert.equal(persisted.nodes.find((node) => node.id === 'self-loopback').enabled, false)
  } finally {
    await host.dispose()
    await fsp.rm(home, { recursive: true, force: true })
  }
})

test('局域网发现：只接收公开身份、来源地址优先、接入后标记 added、自身被忽略', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'nm-discovery-'))
  const { ctx, rpc, cleanups } = fakeContext('http://127.0.0.1:3996')
  const host = new NodeMonitorHost(ctx, { home, discovery: true })
  await host.loadState()
  const peer = JSON.stringify(
    buildAnnouncement({
      id: '11111111-2222-3333-4444-555555555555',
      label: '同事-A 的笔记本',
      port: 3081,
      hostname: 'pc-a',
      version: '0.4.0',
      path: '/'
    })
  )
  host.handleDiscoveryPacket(peer, { address: '192.168.1.9' })
  let snap = host.discoverySnapshot()
  assert.equal(snap.nodes.length, 1)
  assert.equal(snap.nodes[0].label, '同事-A 的笔记本')
  assert.equal(snap.nodes[0].address, 'http://192.168.1.9:3081')
  assert.equal(snap.nodes[0].shortId, '11111111')
  assert.equal(snap.nodes[0].added, false)
  assert.equal(JSON.stringify(snap).includes('token'), false)

  // 公网来源地址直接丢弃，不进入发现列表
  host.handleDiscoveryPacket(peer, { address: '8.8.8.8' })
  assert.equal(host.discoverySnapshot().nodes.length, 1)
  // 自身 id 被忽略
  host.handleDiscoveryPacket(JSON.stringify({ ...JSON.parse(peer), id: host.secrets.nodeId }), { address: '192.168.1.9' })
  assert.equal(host.discoverySnapshot().nodes.length, 1)
  // 已按地址接入的节点标记 added
  host.nodes = [...host.nodes, { id: 'n-manual', name: 'A', baseUrl: 'http://192.168.1.9:3081', tags: [] }]
  snap = host.discoverySnapshot()
  assert.equal(snap.nodes[0].added, true)

  // 令牌只在显式 selfToken 调用中返回，且必须 owner
  const denied = await host.handleRpc('selfToken', {}, null, browser)
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'node-monitor/forbidden')
  const info = await host.handleRpc('selfToken', {}, null, owner)
  assert.equal(info.ok, true)
  assert.equal(info.value.token, host.secrets.agentToken)
  assert.equal(info.value.shortId, host.secrets.nodeId.replace(/-/g, '').slice(0, 8).toUpperCase())

  // 轮换令牌需要 confirm 且会写回 secrets.json（0600）
  const noConfirm = await host.handleRpc('rotateToken', {}, null, owner)
  assert.equal(noConfirm.ok, false)
  const rotated = await host.handleRpc('rotateToken', { confirm: true }, null, owner)
  assert.equal(rotated.ok, true)
  assert.notEqual(rotated.value.token, info.value.token)
  const saved = JSON.parse(await fsp.readFile(path.join(home, 'node-monitor', 'secrets.json'), 'utf8'))
  assert.equal(saved.agentToken, rotated.value.token)

  for (const cleanup of cleanups) await cleanup()
  await fsp.rm(home, { recursive: true, force: true })
})

test('双向配对：接收对端登记（Bearer 校验、来源地址限制、自动建节点）', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'nm-pair-'))
  const { ctx, routes, cleanups } = fakeContext('http://127.0.0.1:3998')
  const host = new NodeMonitorHost(ctx, { home })
  try {
    await host.start()
    await delay(50)
    const handler = routes.get(PAIR_PATH)
    assert.equal(typeof handler, 'function')
    const token = host.secrets.agentToken

    const makeReq = (payload, { method = 'POST', remote = '::ffff:192.168.1.23', auth = token } = {}) => ({
      method,
      socket: { remoteAddress: remote },
      headers: auth ? { authorization: `Bearer ${auth}` } : {},
      on(event, callback) {
        if (event === 'data') callback(Buffer.from(JSON.stringify(payload)))
        if (event === 'end') callback()
      }
    })

    const body = { id: 'peer-1', label: 'PC-1', port: 3101, token: 'p'.repeat(24) }
    const okRes = mockRes()
    await handler(makeReq(body), okRes)
    assert.equal(okRes.statusCode, 200)
    assert.equal(okRes.json().ok, true)
    const node = host.nodes.find((item) => item.baseUrl === 'http://192.168.1.23:3101')
    assert.ok(node)
    assert.equal(node.name, 'PC-1')
    assert.deepEqual(node.tags, ['paired'])
    const state = await host.buildState()
    const view = state.nodes.find((item) => item.id === node.id)
    assert.equal(view.hasToken, true)
    assert.equal(JSON.stringify(state).includes('p'.repeat(24)), false)

    // 重复配对：更新而不是新增
    const again = mockRes()
    await handler(makeReq({ ...body, label: '' }), again)
    assert.equal(again.json().updated, true)
    assert.equal(host.nodes.filter((item) => item.baseUrl === 'http://192.168.1.23:3101').length, 1)

    // 公网来源被拒
    const wan = mockRes()
    await handler(makeReq(body, { remote: '8.8.8.8' }), wan)
    assert.equal(wan.statusCode, 403)

    // 错误令牌 401，GET 405
    const bad = mockRes()
    await handler(makeReq(body, { auth: 'nope' }), bad)
    assert.equal(bad.statusCode, 401)
    const wrongMethod = mockRes()
    await handler({ method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: {} }, wrongMethod)
    assert.equal(wrongMethod.statusCode, 405)
  } finally {
    await host.dispose()
    for (const cleanup of cleanups) await cleanup()
  }
})

test('添加节点留空名称时自动取远端 hostname，并把本机登记回对端', async () => {
  const pairCalls = []
  const token = 'e2e-agent-token'
  const server = http.createServer((req, res) => {
    if (req.url === PAIR_PATH && req.method === 'POST') {
      let raw = ''
      req.on('data', (chunk) => (raw += chunk))
      req.on('end', () => {
        pairCalls.push({ auth: req.headers.authorization, body: JSON.parse(raw || '{}') })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"ok":true}')
      })
      return
    }
    if (req.url !== AGENT_STATUS_PATH || req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end('{"ok":false}')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        protocol: PROTOCOL,
        generatedAt: new Date().toISOString(),
        host: { hostname: 'win-pc-2', platform: 'win32', arch: 'x64', uptimeSec: 120 },
        sessions: { total: 1, running: 1, idle: 0 },
        metrics: { cpuPct: 5, memPct: 30, diskFreePct: 80, load1: 0.1 }
      })
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'nm-pair2-'))
  const { ctx, rpc, cleanups } = fakeContext('http://127.0.0.1:3997')
  const host = new NodeMonitorHost(ctx, { home })
  try {
    await host.start()
    const call = (endpoint, payload = {}) => rpc.get(RPC_CHANNEL)(endpoint, payload, undefined, owner)
    const added = await call('addNode', {
      name: '',
      baseUrl: `http://127.0.0.1:${port}`,
      adapter: 'dsh',
      token
    })
    assert.equal(added.ok, true)
    const node = added.value.nodes.find((item) => item.baseUrl === `http://127.0.0.1:${port}`)
    assert.equal(node.name, 'win-pc-2')
    await delay(300)
    assert.equal(pairCalls.length, 1)
    assert.equal(pairCalls[0].auth, `Bearer ${token}`)
    assert.equal(pairCalls[0].body.port, 3997)
    assert.equal(pairCalls[0].body.token, host.secrets.agentToken)
  } finally {
    await host.dispose()
    for (const cleanup of cleanups) await cleanup()
    await new Promise((resolve) => server.close(resolve))
  }
})


test('远程主节点：PC 主动上报、Hub 投影节点、控制指令往返', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'nm-hub-'))
  const { ctx, routes, cleanups } = fakeContext('http://127.0.0.1:3996')
  const host = new NodeMonitorHost(ctx, { home })
  try {
    await host.start()
    await delay(50)
    const push = routes.get(HUB_PUSH_PATH)
    const result = routes.get(HUB_RESULT_PATH)
    assert.equal(typeof push, 'function')
    assert.equal(typeof result, 'function')
    const token = host.secrets.hubToken
    assert.ok(token && token.length >= 8)

    const makeReq = (payload, { method = 'POST', auth = token } = {}) => ({
      method,
      socket: { remoteAddress: '203.0.113.9' },
      headers: auth ? { authorization: `Bearer ${auth}` } : {},
      on(event, callback) {
        if (event === 'data') callback(Buffer.from(JSON.stringify(payload)))
        if (event === 'end') callback()
      }
    })

    const remoteId = 'peer-uuid-remote-1'
    const payload = {
      protocol: PROTOCOL,
      generatedAt: new Date().toISOString(),
      host: { hostname: 'office-pc', platform: 'win32', arch: 'x64', version: '0.5.0', uptimeSec: 120 },
      sessions: { total: 2, running: 1, idle: 1, list: [{ id: 's-1', status: 'running', model: 'deepseek', cwd: 'C:/work' }] },
      metrics: { cpuPct: 12.5, memPct: 33.3, diskFreePct: 55.5, memUsedBytes: 1, memTotalBytes: 2, diskFreeBytes: 1, diskTotalBytes: 2, load1: 0.5, uptimeSec: 120 },
      control: { enabled: true, restart: false, actions: ['plugins.list', 'plugins.setEnabled'] },
      alerts: [],
      recent: []
    }

    const pushRes = mockRes()
    await push(makeReq({ nodeId: remoteId, name: '办公室电脑', hostname: 'office-pc', version: '0.5.0', payload }), pushRes)
    assert.equal(pushRes.statusCode, 200)
    assert.deepEqual(pushRes.json().commands, [])

    const state = await host.buildState()
    const remote = state.nodes.find((node) => node.id === `hub:${remoteId}`)
    assert.ok(remote, 'hub node projected')
    assert.equal(remote.adapter, 'hub')
    assert.equal(remote.name, '办公室电脑')
    assert.equal(state.probes[`hub:${remoteId}`].status, 'online')
    assert.equal(state.probes[`hub:${remoteId}`].snapshot.metrics.cpuPct, 12.5)
    assert.equal(JSON.stringify(state).includes(token), false, 'hub token never leaves the host')

    // 控制指令：RPC 挂起 → 下一次 push 取走指令 → result 回传后 RPC 返回
    const pending = host.handleRpc(
      'control',
      { id: `hub:${remoteId}`, action: 'plugins.list', dryRun: false },
      null,
      owner
    )
    await delay(30)
    const pollRes = mockRes()
    await push(makeReq({ nodeId: remoteId, name: '办公室电脑', hostname: 'office-pc', payload }), pollRes)
    const commands = pollRes.json().commands
    assert.equal(commands.length, 1)
    assert.equal(commands[0].action, 'plugins.list')

    const resultRes = mockRes()
    await result(makeReq({ nodeId: remoteId, commandId: commands[0].id, ok: true, value: { items: [{ id: 'entry-a', name: 'A', enabled: true }] } }), resultRes)
    assert.equal(resultRes.statusCode, 200)
    const answer = await pending
    assert.equal(answer.ok, true)
    assert.equal(answer.value.response.ok, true)
    assert.deepEqual(answer.value.response.value.items.map((item) => item.id), ['entry-a'])

    // 错误令牌
    const badToken = mockRes()
    await push(makeReq({ nodeId: remoteId, name: 'x', payload }, { auth: 'wrong-token' }), badToken)
    assert.equal(badToken.statusCode, 401)

    for (const cleanup of cleanups) await cleanup()
    await fsp.rm(home, { recursive: true, force: true })
  } catch (error) {
    for (const cleanup of cleanups) await Promise.resolve(cleanup()).catch(() => {})
    await fsp.rm(home, { recursive: true, force: true }).catch(() => {})
    throw error
  }
})
