/**
 * dsh-node-monitor — 宿主侧插件。
 *
 * 职责：
 * 1) 通过 DSH 自带的「已认证 Connection RPC」向浏览器面板提供读写接口
 *    （channel: /node-monitor-rpc），不需要自建会话认证。
 * 2) 通过 raw webServer 路由暴露「节点代理端点」
 *    GET /node-monitor/api/v1/status（Bearer 令牌），供其他 DSH 实例采集。
 * 3) 周期探测所有已接入节点，归并状态、指标、告警，并持久化配置与确认记录。
 *
 * 安全边界：
 * - 令牌只存在于宿主进程内存与 ~/.dsh/node-monitor/secrets.json（0600）；
 * - RPC 返回给浏览器的任何字段都不含令牌；
 * - 日志只记录节点 id / 错误码，不记录令牌与完整响应。
 */

import os from 'node:os'
import dgram from 'node:dgram'
import http from 'node:http'
import path from 'node:path'
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import fsp from 'node:fs/promises'
import * as core from './core.js'
import qrcode from './qrcode.js'

const PLUGIN_ID = 'dsh-node-monitor'
const STATE_VERSION = 1
const MAX_BODY = 1024
const AUTH_FAIL_WINDOW_MS = 60_000
const AUTH_FAIL_LIMIT = 20
const REQUEST_WINDOW_MS = 60_000
const REQUEST_LIMIT = 240
const DISK_CACHE_MS = 30_000
const PLUGIN_VERSION = '0.6.1'

function clampPort(value, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 1 || number > 65535) return fallback
  return Math.round(number)
}

export const name = PLUGIN_ID

/** 只声明真正必需的宿主服务；其余服务用 ctx.get 探测，缺失时优雅降级。 */
export const inject = ['connection', 'webServer']

export function apply(ctx, config) {
  const conf = isObject(config) ? config : {}
  // 安全开关：插件出错时可只改配置/环境变量停用，无需卸载整个 bundle。
  if (conf.enabled === false || process.env.DSH_NODE_MONITOR_DISABLE === '1') {
    try {
      ctx.logger?.info?.('[node-monitor] disabled by config')
    } catch {
      /* ignore */
    }
    return
  }
  let host
  try {
    host = new NodeMonitorHost(ctx, conf)
  } catch (error) {
    try {
      ctx.logger?.error?.(`[node-monitor] construct failed: ${error?.message ?? error}`)
    } catch {
      /* ignore */
    }
    return
  }
  // 重要：apply 绝不能把「等待宿主服务」的 Promise 交给 Loader 等待。
  // 否则安装/热重载插件时，插件激活会被拖到超时，对外表现为整站卡死、崩溃或 502。
  // 这里立即返回 disposer，启动流程在后台自行完成并自行兜底。
  try {
    const pending = host.start()
    if (pending && typeof pending.catch === 'function') {
      pending.catch((error) => {
        try {
          host.logger.error(`async start failed: ${error?.message ?? error}`)
        } catch {
          /* ignore */
        }
      })
    }
  } catch (error) {
    try {
      host.logger.error(`start threw: ${error?.message ?? error}`)
    } catch {
      /* ignore */
    }
  }
  return () => {
    try {
      host.dispose()
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

/** @param {Record<string, unknown> | undefined} config */
function resolveHome(config) {
  const configured =
    typeof config?.home === 'string' && config.home.trim()
      ? config.home.trim()
      : typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim()
        ? process.env.DSH_HOME.trim()
        : ''
  return path.resolve(configured || path.join(os.homedir(), '.dsh'))
}

/** @param {string} file @param {string} data @param {number} mode */
async function writeFileAtomic(file, data, mode = 0o600) {
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.${Date.now()}.${randomUUID().slice(0, 6)}.tmp`
  await fsp.writeFile(tmp, data, { mode })
  await fsp.chmod(tmp, mode).catch(() => {})
  await fsp.rename(tmp, file)
}

/** @param {string} file */
async function readJson(file) {
  try {
    const text = await fsp.readFile(file, 'utf8')
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** @param {unknown} value */
function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** @param {import('node:http').ServerResponse} res @param {number} status @param {unknown} payload */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('content-length', Buffer.byteLength(body))
  res.end(body)
}

/**
 * 读取请求体，超过上限返回 null。
 * @param {import('node:http').IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<string | null>}
 */
function readBody(req, limit) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      resolve(value)
    }
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        finish(null)
        req.destroy?.()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => finish(null))
  })
}


/** @param {import('node:http').IncomingMessage} req */
function requestToken(req) {
  const header = req.headers.authorization
  if (typeof header !== 'string') return ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : ''
}

/** @param {unknown} endpoint */
function normalizeEndpoint(endpoint) {
  const raw = String(endpoint ?? '')
    .split('?')[0]
    .replace(/^.*?node-monitor-rpc/, '')
    .replace(/^\/+/, '')
  return raw.split('/')[0] || ''
}

class RpcError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/* ------------------------------------------------------------------ */
/* 宿主实现                                                            */
/* ------------------------------------------------------------------ */

export class NodeMonitorHost {
  /** @param {any} ctx @param {Record<string, unknown>} config */
  constructor(ctx, config) {
    this.ctx = ctx
    /** 拿到 webServer 注入的子上下文（见 start() 里的 mountWebIntegration） */
    this.hostCtx = null
    this.config = isObject(config) ? config : {}
    this.home = resolveHome(this.config)
    this.dir = path.join(this.home, 'node-monitor')
    this.stateFile = path.join(this.dir, 'state.json')
    this.secretsFile = path.join(this.dir, 'secrets.json')

    /** @type {any[]} */
    this.nodes = []
    this.settings = { ...core.DEFAULT_SETTINGS }
    /** 运维控制：默认关闭，需在插件配置里显式开启 */
    this.allowControl = this.config.allowControl === true || process.env.DSH_NODE_MONITOR_ALLOW_CONTROL === '1'
    this.allowRestart = this.config.allowRestart === true || process.env.DSH_NODE_MONITOR_ALLOW_RESTART === '1'
    this.auditFile = path.join(this.dir, 'audit.jsonl')
    /** 局域网自动发现：只广播公开身份，不广播令牌 */
    this.discoveryEnabled =
      this.config.discovery === true
        ? true
        : this.config.discovery === false || process.env.DSH_NODE_MONITOR_DISCOVERY === '0'
          ? false
          : true
    this.discoveryPort = clampPort(this.config.discoveryPort ?? process.env.DSH_NODE_MONITOR_DISCOVERY_PORT, core.DISCOVERY_PORT)
    this.nodeLabel = core.cleanText(this.config.label, 40) || os.hostname()
    /** 本机 web 端口（attachWeb 时解析，用于双向配对时告知对端） */
    this.serverPort = 0
    /** 自动组网：额外监听 0.0.0.0 的 agent 端口，供局域网节点探测/配对（无需 --host） */
    this.agentPort = core.clampInt(
      this.config.agentPort ?? process.env.DSH_NODE_MONITOR_AGENT_PORT,
      45873,
      1,
      65535
    )
    this.publicListen =
      this.config.publicListen === false
        ? false
        : process.env.DSH_NODE_MONITOR_PUBLIC_LISTEN === '0'
          ? false
          : true
    this.autoPair =
      this.config.autoPair === false
        ? false
        : process.env.DSH_NODE_MONITOR_AUTO_PAIR === '0'
          ? false
          : true
    // 自动组网默认也开放「插件启停」这类 DSH 层控制（仍可被 config.allowControl=false 关闭）。
    if (this.autoPair && this.config.allowControl !== false && process.env.DSH_NODE_MONITOR_ALLOW_CONTROL !== '0') {
      this.allowControl = true
    }
    /** @type {import('node:http').Server | null} */
    this.agentServer = null
    /** @type {Map<string, number>} */
    this.autoPairAttempts = new Map()
    /** 远程主节点（Hub）模式：接受其他 DSH 的主动上报，服务器即主节点 */
    this.hubMode = !(this.config.hub === false || process.env.DSH_NODE_MONITOR_HUB === '0')
    this.publicUrl = core.cleanText(this.config.publicUrl || process.env.DSH_NODE_MONITOR_PUBLIC_URL || '', 300).replace(/\/+$/, '')
    /** 本机作为客户端接入的远程主节点 { url, token } */
    this.hubLink = null
    this.hubTimer = null
    this.hubLastOk = 0
    /** @type {Map<string, any>} */
    this.hubPeers = new Map()
    /** @type {Map<string, any[]>} */
    this.hubCommands = new Map()
    /** @type {Map<string, { resolve: (value:any)=>void, timer:any }>} */
    this.hubResults = new Map()
    /** @type {import('node:dgram').Socket | null} */
    this.discoverySocket = null
    /** @type {any[]} */
    this.discovered = []
    this.discoveryTimer = null
    /** @type {Record<string, string>} */
    this.acks = {}
    this.secrets = {
      agentToken: '',
      tokenSource: 'file',
      nodeTokens: /** @type {Record<string,string>} */ ({}),
      /** 每节点的 DSH 登录地址（含 token，仅在宿主持有） */
      nodeLogins: /** @type {Record<string,string>} */ ({}),
      /** 打开票据的 HMAC 密钥 */
      openSecret: '',
      /** 本节点稳定 id（仅用于局域网发现去重） */
      nodeId: '',
      /** 远程主节点加入令牌（Hub 侧生成，客户端填写） */
      hubToken: '',
      /** 本机作为客户端接入的主节点 { url, token } */
      hubLink: null
    }
    /** @type {Map<string, number>} */
    this.openNonces = new Map()
    /** @type {Map<string, number>} 会话最近活动时间（只记录时间戳，不读会话正文） */
    this.sessionLastAt = new Map()

    /** @type {Map<string, any>} */
    this.probes = new Map()
    /** @type {any[]} */
    this.currentAlerts = []
    /** @type {any[]} */
    this.events = []
    /** @type {Map<string, {count:number, resetAt:number}>} */
    this.authFails = new Map()
    this.requestCounts = new Map()

    /** @type {Set<NodeJS.Timeout>} */
    this.timers = new Set()
    this.tickTimer = null
    this.saveTimer = null
    this.disposed = false
    this.cpuSample = null
    this.diskCache = null
    this.seededSelf = false
    this.startedAt = new Date().toISOString()
    /** @type {Map<string, Promise<any>>} */
    this.inflight = new Map()

    this.logger = (() => {
      try {
        const logger = ctx.logger
        return {
          info: (/** @type {string} */ msg) => logger?.info?.(`[node-monitor] ${msg}`),
          warn: (/** @type {string} */ msg) => logger?.warn?.(`[node-monitor] ${msg}`),
          error: (/** @type {string} */ msg) => logger?.error?.(`[node-monitor] ${msg}`)
        }
      } catch {
        return { info: () => {}, warn: () => {}, error: () => {} }
      }
    })()
  }

  /* ---------------------------------------------------------------- */

  started = false

  /**
   * 启动流程：任何一步失败都只降级，不向 Loader 抛错。
   * 顺序：恢复状态 → 会话事件 → 采集定时器 → Web 集成。
   */
  async start() {
    if (this.started) return
    this.started = true
    try {
      await this.loadState()
    } catch (error) {
      this.logger.warn(`load state failed: ${error?.message ?? error}`)
      this.secrets.agentToken = this.secrets.agentToken || core.generatePairingToken()
    }
    try {
      this.bindSessionEvents()
    } catch (error) {
      this.logger.warn(`session events failed: ${error?.message ?? error}`)
    }
    try {
      this.scheduleCollector()
    } catch (error) {
      this.logger.warn(`collector failed: ${error?.message ?? error}`)
    }
    // 只等一段很短的固定窗口；服务未就绪时挂载会在后台补上，不会阻塞插件激活。
    try {
      await this.mountWebIntegration()
    } catch (error) {
      this.logger.warn(`web integration failed: ${error?.message ?? error}`)
    }
    try {
      this.startAgentServer()
      this.startDiscovery()
      this.startHubClient()
    } catch (error) {
      this.logger.warn(`discovery failed: ${error?.message ?? error}`)
    }
    this.logger.info(
      `started; ${this.nodes.length} node(s); agent endpoint ${this.secrets.agentToken ? 'enabled' : 'disabled'}`
    )
  }

  bindSessionEvents() {
    this.ctx.effect(
      () => {
        const offs = []
        const bind = (/** @type {string} */ event, /** @type {(payload: any) => void} */ handler) => {
          try {
            const off = this.ctx.on(event, handler)
            if (typeof off === 'function') offs.push(off)
          } catch {
            /* 事件不存在时忽略 */
          }
        }
        bind('agent/status', (payload) => {
          const status = payload?.status === 'running' ? 'running' : 'idle'
          this.pushEvent(
            status === 'running' ? 'event.agentRunning' : 'event.agentIdle',
            'agent',
            { agent: shortId(payload?.agent?.id) },
            'info'
          )
        })
        bind('session/event', (session) => {
          const id = session?.id
          if (id) this.sessionLastAt.set(String(id), Date.now())
        })
        bind('agent/created', (payload) =>
          this.pushEvent('event.agentCreated', 'agent', { agent: shortId(payload?.agent?.id) }, 'info')
        )
        bind('agent/disposed', (payload) =>
          this.pushEvent('event.agentDisposed', 'agent', { agent: shortId(payload?.agent?.id) }, 'info')
        )
        return () => {
          for (const off of offs) {
            try {
              off()
            } catch {
              /* ignore */
            }
          }
        }
      },
      'node-monitor: session events'
    )
  }

  scheduleCollector() {
    this.ctx.effect(
      () => {
        this.tickTimer = setTimeout(() => this.tick(), 600)
        return () => {
          if (this.tickTimer) clearTimeout(this.tickTimer)
          this.tickTimer = null
          for (const timer of this.timers) clearTimeout(timer)
          this.timers.clear()
          if (this.saveTimer) clearTimeout(this.saveTimer)
          this.disposed = true
          this.saveNow().catch(() => {})
        }
      },
      'node-monitor: collector'
    )
  }

  /** 停用插件时的清理；可重复调用。 */
  dispose() {
    if (this.disposed) return
    this.disposed = true
    if (this.tickTimer) clearTimeout(this.tickTimer)
    this.tickTimer = null
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.stopDiscovery()
    this.stopAgentServer()
    this.stopHubClient()
    this.hostCtx = null
    try {
      void this.saveNow()
    } catch {
      /* ignore */
    }
  }

  /* ---------------------------------------------------------------- */
  /* 局域网自动发现                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * UDP 发现：只广播短 id / 显示名 / 端口 / 版本，绝不广播令牌。
   * 监听端把来源地址作为节点地址（不信任报文自述地址）。
   * 发现到的节点仅用于「提示可接入」，真正接入必须由操作者填写对方令牌。
   */
  /* --------------------------- 自动组网（v0.5.0） --------------------------- */

  startAgentServer() {
    if (!this.publicListen || this.agentServer) return
    const server = http.createServer((req, res) => {
      this.handlePublicRequest(req, res).catch((error) => {
        this.logger.warn(`agent server request failed: ${error?.message ?? error}`)
        try {
          sendJson(res, 500, { ok: false, error: 'internal' })
        } catch {
          /* ignore */
        }
      })
    })
    server.on('error', (error) => {
      console.error(`[node-monitor] agent server error ${error?.code} ${error?.message}`)
      this.logger.warn(`agent server error: ${error?.message ?? error}`)
      if (error?.code === 'EADDRINUSE' && this.agentPort !== 0) {
        try {
          server.close()
        } catch {
          /* ignore */
        }
        this.agentServer = null
        this.agentPort = 0
        this.startAgentServer()
      }
    })
    server.listen(this.agentPort, '0.0.0.0', () => {
      try {
        const address = server.address()
        if (address && typeof address === 'object') this.agentPort = address.port
      } catch {
        /* ignore */
      }
    })
    server.unref?.()
    this.agentServer = server
  }

  stopAgentServer() {
    const server = this.agentServer
    this.agentServer = null
    if (!server) return
    try {
      server.close()
    } catch {
      /* ignore */
    }
  }

  async handlePublicRequest(req, res) {
    const url = new URL(req.url || '/', 'http://localhost')
    const path = url.pathname
    if (path === core.AGENT_STATUS_PATH) return this.handleAgentRequest(req, res, 'status')
    if (path === core.AGENT_HEALTH_PATH) return this.handleAgentRequest(req, res, 'health')
    if (path === core.PAIR_PATH) return this.handlePairRequest(req, res)
    if (path === core.CONTROL_PATH) return this.handleControlRequest(req, res)
    if (path === core.HUB_PUSH_PATH) return this.handleHubPush(req, res)
    if (path === core.HUB_RESULT_PATH) return this.handleHubResult(req, res)
    sendJson(res, 404, { ok: false, error: 'not-found' })
  }

  maybeAutoPair(peer) {
    if (!this.autoPair || !this.agentPort) return
    if (!peer || !peer.agentPort || !core.isLanAddress(peer.address)) return
    if (peer.id === this.secrets.nodeId) return
    const key = String(peer.id || peer.address)
    const last = this.autoPairAttempts.get(key) || 0
    const now = Date.now()
    if (now - last < 60_000) return
    const host = peer.address.includes(':') ? `[${peer.address}]` : peer.address
    const baseUrl = `http://${host}:${peer.agentPort}`
    if (this.nodes.some((node) => node.baseUrl === baseUrl)) return
    this.autoPairAttempts.set(key, now)
    void this.tryAutoPair(peer)
  }

  async tryAutoPair(peer) {
    const host = peer.address.includes(':') ? `[${peer.address}]` : peer.address
    const baseUrl = `http://${host}:${peer.agentPort}`
    try {
      const response = await fetch(`${baseUrl}${core.PAIR_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: '',
          'x-node-monitor-auto': '1'
        },
        body: JSON.stringify({
          id: this.secrets.nodeId,
          label: this.nodeLabel,
          port: this.serverPort,
          agentPort: this.agentPort,
          token: this.secrets.agentToken,
          auto: true
        }),
        signal: AbortSignal.timeout(Math.max(2000, this.settings.timeoutMs)),
        redirect: 'error'
      })
      if (!response.ok) return
      const payload = await response.json().catch(() => null)
      if (!payload || !payload.ok || !payload.token) return
      if (this.nodes.some((node) => node.baseUrl === baseUrl)) return
      if (!this.canAdd(null)) return
      const now = core.nowIso()
      const name = peer.label || peer.hostname || peer.address
      const node = {
        id: `n-${randomUUID().slice(0, 8)}`,
        name,
        baseUrl,
        adapter: 'dsh',
        path: null,
        tags: ['paired', 'auto'],
        enabled: true,
        network: 'lan',
        notes: '',
        createdAt: now,
        updatedAt: now
      }
      this.nodes = [...this.nodes, node]
      this.secrets.nodeTokens[node.id] = payload.token
      await this.writeSecrets()
      this.pushEvent('event.nodeAutoPaired', 'node', { name }, 'info')
      await this.saveNow()
      void this.probeNode(node)
    } catch (error) {
      if (process.env.DSH_NODE_MONITOR_DEBUG === '1') {
        console.log(`[nm] auto pair failed for ${peer.address}: ${error?.message ?? error}`)
      }
    }
  }

  startDiscovery() {
    if (!this.discoveryEnabled || this.discoverySocket) return
    let socket
    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    } catch (error) {
      this.logger.warn(`discovery socket failed: ${error?.message ?? error}`)
      return
    }
    this.discoverySocket = socket
    socket.on('error', (error) => {
      this.logger.warn(`discovery socket error: ${error?.message ?? error}`)
      try {
        socket.close()
      } catch {
        /* ignore */
      }
      if (this.discoverySocket === socket) this.discoverySocket = null
    })
    socket.on('message', (message, rinfo) => {
      try {
        this.handleDiscoveryPacket(message, rinfo)
      } catch (error) {
        this.logger.warn(`discovery packet failed: ${error?.message ?? error}`)
      }
    })
    socket.bind(this.discoveryPort, '0.0.0.0', () => {
      try {
        socket.addMembership(core.DISCOVERY_MULTICAST)
      } catch {
        /* 某些平台/网络不允许组播，降级为广播 */
      }
      try {
        socket.setBroadcast(true)
      } catch {
        /* ignore */
      }
      try {
        socket.setMulticastTTL(1)
      } catch {
        /* ignore */
      }
      this.announceDiscovery()
      this.discoveryTimer = setInterval(() => this.announceDiscovery(), 30_000)
      this.discoveryTimer.unref?.()
      this.logger.info(`discovery listening on udp:${this.discoveryPort}`)
    })
  }

  stopDiscovery() {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer)
      this.discoveryTimer = null
    }
    const socket = this.discoverySocket
    this.discoverySocket = null
    if (!socket) return
    try {
      socket.close()
    } catch {
      /* ignore */
    }
  }

  /** 广播一次自身身份；附加 DSH_NODE_MONITOR_DISCOVERY_PEERS 里的单播目标（便于本机双实例测试）。 */
  announceDiscovery() {
    const socket = this.discoverySocket
    if (!socket) return
    const origin = safeOrigin(this.hostCtx ?? this.ctx)
    let port = 3081
    let pathname = '/'
    try {
      const parsed = new URL(origin)
      if (parsed.port) port = Number(parsed.port) || port
      pathname = parsed.pathname || '/'
    } catch {
      /* ignore */
    }
    const payload = Buffer.from(
      JSON.stringify(
        core.buildAnnouncement({
          id: this.secrets.nodeId,
          label: this.nodeLabel,
          port,
          hostname: os.hostname(),
          version: PLUGIN_VERSION,
          agentPort: this.agentPort,
          path: pathname
        })
      )
    )
    const send = (address, targetPort) => {
      try {
        socket.send(payload, 0, payload.length, targetPort, address, () => {})
      } catch {
        /* ignore */
      }
    }
    if (process.env.DSH_NODE_MONITOR_DEBUG === '1') console.log(`[nm] announce port=${port} ap=${this.agentPort}`)
    send(core.DISCOVERY_MULTICAST, this.discoveryPort)
    send('255.255.255.255', this.discoveryPort)
    send('127.0.0.1', this.discoveryPort)
    const peers = String(process.env.DSH_NODE_MONITOR_DISCOVERY_PEERS || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    for (const peer of peers) {
      const match = /^([^:]+)(?::(\d{1,5}))?$/.exec(peer)
      if (!match) continue
      send(match[1], match[2] ? Number(match[2]) : this.discoveryPort)
    }
  }

  handleDiscoveryPacket(raw, rinfo) {
    if (!this.discoveryEnabled) return
    if (process.env.DSH_NODE_MONITOR_DEBUG === '1') console.log(`[nm] packet ${raw?.length}B from ${rinfo?.address}`)
    const parsed = core.parseAnnouncement(raw, {
      selfId: this.secrets.nodeId,
      address: rinfo?.address,
      now: Date.now()
    })
    if (!parsed.ok) {
      if (process.env.DSH_NODE_MONITOR_DEBUG === '1') console.log(`[nm] parse fail ${parsed.error?.code}`)
      return
    }
    this.discovered = core.mergeDiscovery(this.discovered, parsed.value)
    this.maybeAutoPair(parsed.value)
  }

  discoverySnapshot() {
    const now = Date.now()
    this.discovered = this.discovered.filter((item) => now - (Number(item.lastSeen) || 0) <= core.DISCOVERY_TTL_MS)
    const added = new Set(this.nodes.map((node) => String(node.baseUrl || '').toLowerCase().replace(/\/$/, '')))
    return {
      enabled: Boolean(this.discoverySocket),
      label: this.nodeLabel,
      port: this.discoveryPort,
      nodes: this.discovered.map((item) => {
        const address = core.discoveryAddress(item)
        return {
          id: item.id,
          shortId: core.shortNodeId(item.id),
          label: item.label,
          hostname: item.hostname,
          version: item.version,
          address,
          lastSeen: new Date(item.lastSeen).toISOString(),
          added: added.has(address.toLowerCase().replace(/\/$/, ''))
        }
      })
    }
  }

  selfIdentity() {
    return {
      id: this.secrets.nodeId,
      shortId: core.shortNodeId(this.secrets.nodeId),
      label: this.nodeLabel,
      token: this.secrets.agentToken,
      source: this.secrets.tokenSource
    }
  }

  /* ---------------------------------------------------------------- */
  /* Web 集成（RPC + raw 路由）                                         */
  /* ---------------------------------------------------------------- */

  /**
   * 挂载 Connection RPC 与 raw 节点代理路由。
   *
   * dsh 0.2.2-rc.1 里 `connection.rpc.handle()` 会用「调用方 ctx」注册 /api 路由，
   * 注册动作内部要读 `owner.webServer`；调用方 ctx 读不到 webServer 时抛
   * `cannot get property "webServer" without inject`。这里沿用官方插件写法：
   * 在 ctx.inject 的子上下文里 extend 出 webServer 后再注册。
   *
   * 为保证安装/热重载时插件激活不被拖住，这里只等待一个 1.5s 的短窗口：
   * 服务已就绪则立即挂载；未就绪则挂载在后台完成，客户端轮询会自动重试。
   */
  async mountWebIntegration() {
    return new Promise((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve()
      }
      const guard = setTimeout(() => {
        this.logger.warn('web integration not ready within 1.5s; will attach in background')
        finish()
      }, 1500)
      guard.unref?.()
      try {
        this.ctx.inject(['connection', 'webServer'], (webContext) => {
          try {
            this.attachWeb(webContext)
          } catch (error) {
            this.logger.error(`web integration attach failed: ${error?.message ?? error}`)
          }
          clearTimeout(guard)
          finish()
        })
      } catch (error) {
        this.logger.error(`web integration mount failed: ${error?.message ?? error}`)
        clearTimeout(guard)
        finish()
      }
    })
  }

  /** 在可用的子上下文上注册 RPC 与两条 raw 路由；全部单独兜底。 */
  attachWeb(webContext) {
    if (this.disposed) return
    let hostCtx = webContext
    try {
      hostCtx = webContext.extend({ webServer: webContext.get('webServer') })
    } catch (error) {
      this.logger.warn(`extend host ctx failed: ${error?.message ?? 'unknown'}`)
    }
    this.hostCtx = hostCtx
    try {
      const origin = new URL(hostCtx.webServer.getOrigin())
      this.serverPort = Number(origin.port) || (origin.protocol === 'https:' ? 443 : 80)
    } catch {
      this.serverPort = 0
    }
    this.attachRpc(hostCtx, 0)

    const routes = [
      {
        kind: 'exact',
        path: core.AGENT_STATUS_PATH,
        handler: (req, res) => this.handleAgentRequest(req, res, 'status')
      },
      {
        kind: 'exact',
        path: core.AGENT_HEALTH_PATH,
        handler: (req, res) => this.handleAgentRequest(req, res, 'health')
      },
      {
        kind: 'exact',
        path: core.OPEN_PATH,
        handler: (req, res) => this.handleOpenRequest(req, res)
      },
      {
        kind: 'exact',
        path: core.PAIR_PATH,
        handler: (req, res) => this.handlePairRequest(req, res)
      },
      {
        kind: 'exact',
        path: core.CONTROL_PATH,
        handler: (req, res) => this.handleControlRequest(req, res)
      },
      {
        kind: 'exact',
        path: core.HUB_PUSH_PATH,
        handler: (req, res) => this.handleHubPush(req, res)
      },
      {
        kind: 'exact',
        path: core.HUB_RESULT_PATH,
        handler: (req, res) => this.handleHubResult(req, res)
      }
    ]
    for (const route of routes) {
      try {
        hostCtx.effect(() => hostCtx.webServer.register(route), `node-monitor: route ${route.path}`)
      } catch (error) {
        this.logger.warn(`route register failed: ${route.path} (${error?.message ?? 'unknown'})`)
      }
    }
  }

  /**
   * 注册 RPC 通道。热重载的瞬间旧实例可能还占着同一个 channel，
   * 因此这里做几次短重试，而不是把异常抛出去。
   */
  attachRpc(hostCtx, attempt) {
    if (this.disposed) return
    try {
      hostCtx.connection.rpc.handle(core.RPC_CHANNEL, (endpoint, payload, signal, peer) =>
        this.handleRpc(endpoint, payload, signal, peer)
      )
      this.logger.info('rpc channel mounted')
    } catch (error) {
      if (attempt < 5) {
        const timer = setTimeout(() => this.attachRpc(hostCtx, attempt + 1), 400)
        timer.unref?.()
        this.timers.add(timer)
        return
      }
      this.logger.error(`rpc register failed after retries: ${error?.message ?? 'unknown'}`)
    }
  }

  /* ---------------------------------------------------------------- */
  /* 持久化                                                            */
  /* ---------------------------------------------------------------- */

  async loadState() {
    await fsp.mkdir(this.dir, { recursive: true, mode: 0o700 }).catch(() => {})

    const secretsRaw = await readJson(this.secretsFile)
    const envToken =
      typeof process.env.DSH_NODE_MONITOR_TOKEN === 'string' ? process.env.DSH_NODE_MONITOR_TOKEN.trim() : ''
    let fileToken = typeof secretsRaw?.agentToken === 'string' ? secretsRaw.agentToken.trim() : ''
    if (!envToken && !fileToken) fileToken = core.generatePairingToken()
    this.secrets = {
      agentToken: envToken || fileToken,
      tokenSource: envToken ? 'env' : 'file',
      nodeTokens: isObject(secretsRaw?.nodeTokens) ? { ...secretsRaw.nodeTokens } : {},
      nodeLogins: isObject(secretsRaw?.nodeLogins) ? { ...secretsRaw.nodeLogins } : {},
      openSecret:
        typeof secretsRaw?.openSecret === 'string' && secretsRaw.openSecret.length >= 32
          ? secretsRaw.openSecret
          : randomBytes(32).toString('hex'),
      nodeId:
        typeof secretsRaw?.nodeId === 'string' && /^[a-f0-9-]{8,64}$/i.test(secretsRaw.nodeId)
          ? secretsRaw.nodeId
          : randomUUID(),
      hubToken:
        typeof secretsRaw?.hubToken === 'string' && secretsRaw.hubToken.length >= 8
          ? secretsRaw.hubToken
          : core.generatePairingToken(),
      hubLink:
        isObject(secretsRaw?.hubLink) && typeof secretsRaw.hubLink.url === 'string'
          ? { url: core.cleanText(secretsRaw.hubLink.url, 300), token: core.cleanText(secretsRaw.hubLink.token, 120) }
          : null
    }
    this.hubLink = this.secrets.hubLink
      ? { url: this.secrets.hubLink.url, token: this.secrets.hubLink.token }
      : null
    if (!envToken && (secretsRaw?.agentToken !== fileToken || secretsRaw?.nodeId !== this.secrets.nodeId)) {
      await this.writeSecrets().catch((error) => this.logger.warn(`write secrets failed: ${error?.message ?? ''}`))
    }

    const persisted = await readJson(this.stateFile)
    if (persisted) {
      const restored = core.fromPersistedState(persisted)
      this.nodes = restored.nodes
      this.settings = restored.settings
      this.acks = restored.acks
      this.seededSelf = restored.seededSelf === true
    }

    if (!this.seededSelf && this.nodes.length === 0) {
      const self = await this.makeSelfNode()
      if (self) {
        this.nodes = [self]
        this.seededSelf = true
      }
      await this.saveNow().catch(() => {})
    }
  }

  async writeSecrets() {
    await writeFileAtomic(
      this.secretsFile,
      JSON.stringify(
        {
          agentToken: this.secrets.agentToken,
          nodeTokens: this.secrets.nodeTokens,
          nodeLogins: this.secrets.nodeLogins,
          openSecret: this.secrets.openSecret,
          nodeId: this.secrets.nodeId,
          hubToken: this.secrets.hubToken,
          hubLink: this.hubLink ? { url: this.hubLink.url, token: this.hubLink.token } : null
        },
        null,
        2
      ),
      0o600
    )
  }

  async makeSelfNode() {
    const origin = safeOrigin(this.hostCtx ?? this.ctx)
    if (!origin) return null
    const now = core.nowIso()
    return {
      id: 'self-loopback',
      name: '本机自检节点',
      baseUrl: origin,
      adapter: 'dsh',
      path: null,
      tags: ['self'],
      enabled: true,
      createdAt: now,
      updatedAt: now
    }
  }

  saveSoon() {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.saveNow().catch((error) => this.logger.warn(`save failed: ${error?.message ?? ''}`))
    }, 250)
  }

  async saveNow() {
    const payload = core.toPersistedState({
      nodes: this.nodes,
      settings: this.settings,
      acks: this.acks,
      seededSelf: this.seededSelf === true,
      version: STATE_VERSION
    })
    await writeFileAtomic(this.stateFile, JSON.stringify(payload, null, 2), 0o600)
  }

  /* ---------------------------------------------------------------- */
  /* 事件                                                              */
  /* ---------------------------------------------------------------- */

  /** @param {string} code @param {string} kind @param {Record<string, unknown>} params @param {'info'|'warning'|'critical'} level */
  pushEvent(code, kind, params, level = 'info') {
    this.events = core.appendEvent(
      this.events,
      {
        at: core.nowIso(),
        code: core.cleanText(code, 60),
        kind: core.cleanText(kind, 40),
        level,
        params: core.jsonSafe(params) || {}
      },
      Math.min(80, Math.max(20, this.settings.eventsLimit * 2))
    )
  }

  /* ---------------------------------------------------------------- */
  /* 采集                                                              */
  /* ---------------------------------------------------------------- */

  scheduleNextTick() {
    if (this.disposed) return
    const delay = Math.max(1000, Math.min(120000, this.settings.refreshMs))
    this.tickTimer = setTimeout(() => this.tick(), delay)
  }

  async tick() {
    if (this.disposed) return
    try {
      await this.probeAll()
    } catch (error) {
      this.logger.warn(`probe cycle failed: ${error?.message ?? 'unknown'}`)
    } finally {
      this.scheduleNextTick()
    }
  }

  async probeAll() {
    const enabled = this.nodes.filter((node) => node.enabled)
    await Promise.all(enabled.map((node) => this.probeNode(node)))
    this.recomputeAlerts()
  }

  /** @param {any} node */
  async probeNode(node) {
    const existing = this.inflight.get(node.id)
    if (existing) return existing
    const running = this.runProbe(node)
    this.inflight.set(node.id, running)
    try {
      return await running
    } finally {
      this.inflight.delete(node.id)
    }
  }

  /** @param {any} node */
  async runProbe(node) {
    const token = await this.tokenForNode(node)
    const outcome = await core.probeEndpoint({
      node,
      token,
      timeoutMs: this.settings.timeoutMs
    })
    if (this.disposed) return null
    const previous = this.probes.get(node.id) ?? null
    const record = core.probeRecordFromOutcome(outcome, previous)
    if (record.status === 'ok') record.lastSeenAt = record.checkedAt
    else if (previous?.lastSeenAt) record.lastSeenAt = previous.lastSeenAt

    const before = previous ? core.classifyProbe(previous, this.settings) : 'unknown'
    const after = core.classifyProbe(record, this.settings)
    this.probes.set(node.id, record)
    if (before !== after) {
      this.pushEvent(
        `event.node.${after}`,
        'node',
        { name: node.name, id: node.id, reason: record.error?.code ?? '' },
        after === 'offline' ? 'critical' : after === 'online' ? 'info' : 'warning'
      )
    }
    this.recomputeAlerts()
    return record
  }

  /** @param {any} node */
  async tokenForNode(node) {
    if (Array.isArray(node.tags) && node.tags.includes('self')) return this.secrets.agentToken
    const stored = this.secrets.nodeTokens[node.id]
    return typeof stored === 'string' ? stored : ''
  }

  recomputeAlerts() {
    const computed = core.computeAlerts({
      nodes: this.allNodes(),
      probes: this.rawProbeMap(),
      settings: this.settings,
      previous: this.currentAlerts
    })
    const live = new Set(computed.map((alert) => alert.key))
    for (const key of Object.keys(this.acks)) {
      if (!live.has(key)) delete this.acks[key]
    }
    this.currentAlerts = computed.map((alert) => ({
      ...alert,
      acked: Object.prototype.hasOwnProperty.call(this.acks, alert.key)
    }))
  }

  /* ---------------------------------------------------------------- */
  /* 本机快照（节点代理端点内容）                                       */
  /* ---------------------------------------------------------------- */

  sessionStats() {
    let agents = []
    try {
      const service = this.ctx.get?.('agents')
      const value = service?.list?.()
      if (Array.isArray(value)) agents = value
      else if (Array.isArray(service?.roots?.())) agents = service.roots()
    } catch {
      agents = []
    }
    let running = 0
    const list = []
    for (const agent of agents) {
      const status = agent?.status === 'running' ? 'running' : 'idle'
      if (status === 'running') running += 1
      const header = agent?.session?.header ?? {}
      const id = String(agent?.id ?? agent?.session?.id ?? '')
      if (!id) continue
      const model = [agent?.options?.provider, agent?.options?.model].filter(Boolean).join(' / ')
      list.push({
        id,
        title: '',
        status,
        model,
        cwd: String(header.cwd ?? ''),
        createdAt: isoTime(header.createdAt),
        lastAt: isoTime(this.sessionLastAt.get(id)),
        parentId: header.parentSession ? String(header.parentSession) : '',
        depth: typeof header.delegationDepth === 'number' ? header.delegationDepth : null,
        seeded: Boolean(header.isSeeded)
      })
    }
    list.sort((a, b) => String(b.lastAt ?? '').localeCompare(String(a.lastAt ?? '')))
    return {
      total: agents.length,
      running,
      idle: Math.max(0, agents.length - running),
      list: list.slice(0, 20)
    }
  }

  cpuUsage() {
    const cpus = os.cpus() ?? []
    let idle = 0
    let total = 0
    for (const cpu of cpus) {
      const times = cpu?.times ?? {}
      idle += Number(times.idle) || 0
      total +=
        (Number(times.user) || 0) +
        (Number(times.nice) || 0) +
        (Number(times.sys) || 0) +
        (Number(times.idle) || 0) +
        (Number(times.irq) || 0)
    }
    const sample = { idle, total }
    const previous = this.cpuSample
    this.cpuSample = sample
    if (!previous || total <= previous.total || idle < previous.idle) return null
    const deltaTotal = total - previous.total
    const deltaIdle = idle - previous.idle
    if (deltaTotal <= 0) return null
    return ((deltaTotal - deltaIdle) / deltaTotal) * 100
  }

  async diskUsage() {
    const now = Date.now()
    if (this.diskCache && now - this.diskCache.at < DISK_CACHE_MS) return this.diskCache.value
    try {
      const stats = await fsp.statfs(this.home)
      const value = {
        freeBytes: stats.bavail * stats.bsize,
        totalBytes: stats.blocks * stats.bsize
      }
      this.diskCache = { at: now, value }
      return value
    } catch {
      return null
    }
  }

  async buildAgentPayload() {
    const memUsed = os.totalmem() - os.freemem()
    const disk = await this.diskUsage()
    return {
      protocol: core.PROTOCOL,
      generatedAt: core.nowIso(),
      host: {
        hostname: os.hostname(),
        platform: process.platform,
        arch: process.arch,
        version: typeof process.env.DSH_VERSION === 'string' ? process.env.DSH_VERSION : '',
        uptimeSec: Math.round(os.uptime())
      },
      sessions: this.sessionStats(),
      metrics: core.formatMetrics({
        cpuPct: this.cpuUsage(),
        memUsedBytes: memUsed,
        memTotalBytes: os.totalmem(),
        diskFreeBytes: disk?.freeBytes ?? null,
        diskTotalBytes: disk?.totalBytes ?? null,
        load1: process.platform === 'win32' ? null : os.loadavg()[0]
      }),
      control: {
        enabled: this.allowControl,
        restart: this.allowRestart,
        actions: this.allowControl ? core.CONTROL_ACTIONS.slice() : []
      },
      alerts: [],
      recent: this.events.slice(0, 15)
    }
  }


  /* --------------------------- 远程主节点（Hub） --------------------------- */

  /** PC 侧：向远程主节点持续上报（出站连接，无需公网 IP/端口映射）。 */
  startHubClient() {
    if (!this.hubLink?.url || this.disposed) return
    if (this.hubTimer) return
    this.scheduleHubPush(800)
  }

  stopHubClient() {
    if (this.hubTimer) clearTimeout(this.hubTimer)
    this.hubTimer = null
  }

  /** @param {number} delay */
  scheduleHubPush(delay) {
    if (this.disposed || !this.hubLink?.url) return
    if (this.hubTimer) clearTimeout(this.hubTimer)
    const timer = setTimeout(() => {
      this.hubTimer = null
      this.pushHubOnce().catch(() => {})
    }, Math.max(0, delay))
    timer.unref?.()
    this.hubTimer = timer
    this.timers.add(timer)
  }

  async pushHubOnce() {
    if (this.disposed || !this.hubLink?.url) return
    const link = this.hubLink
    try {
      const payload = await this.buildAgentPayload()
      const controller = new AbortController()
      const guard = setTimeout(() => controller.abort(), 15000)
      guard.unref?.()
      let data = null
      try {
        const response = await fetch(`${link.url.replace(/\/+$/, '')}${core.HUB_PUSH_PATH}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${link.token}` },
          body: JSON.stringify({
            nodeId: this.secrets.nodeId,
            name: this.nodeLabel,
            hostname: os.hostname(),
            version: PLUGIN_VERSION,
            payload
          }),
          redirect: 'error',
          signal: controller.signal
        })
        if (response.ok) {
          this.hubLastOk = Date.now()
          data = await response.json().catch(() => null)
        }
      } finally {
        clearTimeout(guard)
      }
      if (Array.isArray(data?.commands) && data.commands.length > 0) {
        await this.runHubCommands(data.commands)
      }
    } catch {
      /* 主节点暂不可达时静默重试 */
    } finally {
      if (!this.disposed && this.hubLink) this.scheduleHubPush(3000)
    }
  }

  /** @param {any[]} commands */
  async runHubCommands(commands) {
    for (const command of commands) {
      const commandId = core.cleanText(command?.id, 60)
      if (!commandId) continue
      const action = core.cleanText(command?.action, 40)
      let result
      try {
        if (action !== 'plugins.list' && action !== 'plugins.setEnabled') {
          throw Object.assign(new Error('主节点下发的动作不受支持'), { code: 'control-action-invalid' })
        }
        const value = await this.dispatchControl({
          action,
          params: core.jsonSafe(command?.params ?? {}) || {},
          dryRun: command?.dryRun === true,
          confirm: command?.confirm === true
        })
        result = { ok: true, value }
      } catch (error) {
        result = { ok: false, error: typeof error?.code === 'string' ? error.code : 'control-failed' }
      }
      await this.sendHubResult({ commandId, ...result })
    }
  }


  /** @param {Record<string, any>} body */
  async connectHub(body) {
    const raw = core.cleanText(body?.url, 300).replace(/\/+$/, '')
    const token = core.cleanText(body?.token, 120)
    let parsed
    try {
      parsed = new URL(raw)
    } catch {
      throw new RpcError('hub-url-invalid', '主节点地址不合法')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new RpcError('hub-url-invalid', '主节点地址只支持 http/https')
    }
    if (!token || token.length < 8) throw new RpcError('hub-token-invalid', '加入令牌不合法')
    const basePath = parsed.pathname.replace(/\/+$/, '')
    this.hubLink = { url: `${parsed.protocol}//${parsed.host}${basePath}`, token }
    await this.writeSecrets()
    this.stopHubClient()
    this.startHubClient()
    this.pushEvent('event.hubLinked', 'hub', { url: this.hubLink.url }, 'info')
    return this.buildState()
  }

  async disconnectHub() {
    this.hubLink = null
    this.stopHubClient()
    await this.writeSecrets()
    this.pushEvent('event.hubUnlinked', 'hub', {}, 'warn')
    return this.buildState()
  }

  /** @param {Record<string, unknown>} body */
  async sendHubResult(body) {
    if (!this.hubLink?.url) return
    try {
      await fetch(`${this.hubLink.url.replace(/\/+$/, '')}${core.HUB_RESULT_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.hubLink.token}` },
        body: JSON.stringify({ nodeId: this.secrets.nodeId, ...body }),
        redirect: 'error',
        signal: AbortSignal.timeout(10000)
      })
    } catch {
      /* ignore */
    }
  }

  /** Hub 侧：接收 PC 的主动上报，返回排队中的控制指令。 */
  async handleHubPush(req, res) {
    if (!this.hubMode) return sendJson(res, 404, { ok: false, error: 'hub-disabled' })
    if ((req.method || 'GET').toUpperCase() !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
    const token = requestToken(req)
    if (!this.secrets.hubToken || !core.compareTokens(token, this.secrets.hubToken)) {
      res.setHeader('www-authenticate', 'Bearer realm="dsh-node-monitor-hub"')
      return sendJson(res, 401, { ok: false, error: 'unauthorized' })
    }
    let body
    try {
      const raw = await readBody(req, 128 * 1024)
      body = JSON.parse(raw || '{}')
    } catch (error) {
      return sendJson(res, error?.code === 'body-too-large' ? 413 : 400, { ok: false, error: 'bad-json' })
    }
    const nodeId = core.cleanText(body?.nodeId, 64)
    if (!nodeId) return sendJson(res, 400, { ok: false, error: 'invalid-node' })
    const previous = this.hubPeers.get(nodeId) || null
    const peer = {
      nodeId,
      name: core.cleanText(body?.name, 64) || core.shortNodeId(nodeId),
      hostname: core.cleanText(body?.hostname, 120),
      version: core.cleanText(body?.version, 40),
      payload: core.sanitizeSnapshot(body?.payload),
      lastSeen: Date.now()
    }
    this.hubPeers.set(nodeId, peer)
    if (!previous) this.pushEvent('event.hubPeerJoined', 'hub', { name: peer.name }, 'info')
    const commands = this.hubCommands.get(nodeId) || []
    this.hubCommands.set(nodeId, [])
    sendJson(res, 200, { ok: true, commands, hub: { label: this.nodeLabel } })
  }

  /** Hub 侧：接收 PC 执行结果。 */
  async handleHubResult(req, res) {
    if (!this.hubMode) return sendJson(res, 404, { ok: false, error: 'hub-disabled' })
    if ((req.method || 'GET').toUpperCase() !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
    const token = requestToken(req)
    if (!this.secrets.hubToken || !core.compareTokens(token, this.secrets.hubToken)) {
      return sendJson(res, 401, { ok: false, error: 'unauthorized' })
    }
    let body
    try {
      const raw = await readBody(req, 64 * 1024)
      body = JSON.parse(raw || '{}')
    } catch {
      return sendJson(res, 400, { ok: false, error: 'bad-json' })
    }
    const commandId = core.cleanText(body?.commandId, 60)
    const waiter = commandId ? this.hubResults.get(commandId) : null
    if (waiter) {
      this.hubResults.delete(commandId)
      clearTimeout(waiter.timer)
      waiter.resolve({
        ok: body?.ok === true,
        value: core.jsonSafe(body?.value ?? null),
        error: core.cleanText(body?.error, 60)
      })
    }
    sendJson(res, 200, { ok: true })
  }

  /** @param {string} peerId @param {Record<string, any>} body */
  async controlHubNode(peerId, body) {
    const peer = this.hubPeers.get(peerId)
    if (!peer) throw new RpcError('not-found', '远程节点不存在')
    const action = core.cleanText(body?.action, 40)
    if (!core.CONTROL_ACTIONS.includes(action)) throw new RpcError('control-action-invalid', '未知的运维动作')
    const commandId = `c-${randomUUID().slice(0, 8)}`
    const command = {
      id: commandId,
      action,
      params: core.jsonSafe(body?.params ?? {}) || {},
      dryRun: body?.dryRun !== false,
      confirm: body?.confirm === true
    }
    const queue = this.hubCommands.get(peerId) || []
    queue.push(command)
    this.hubCommands.set(peerId, queue)
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.hubResults.delete(commandId)
        resolve({ ok: false, value: null, error: 'timeout' })
      }, 20_000)
      timer.unref?.()
      this.hubResults.set(commandId, { resolve, timer })
    })
    this.pushEvent('event.control', 'control', { name: peer.name, action }, 'info')
    return {
      status: 200,
      response: result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error || 'control-failed' }
    }
  }

  /** Hub 侧：把远程节点投影成普通节点，复用现有卡片/详情/告警。 */
  hubNodes() {
    const now = Date.now()
    const rows = []
    for (const peer of this.hubPeers.values()) {
      const fresh = now - peer.lastSeen < 20_000
      rows.push({
        id: `hub:${peer.nodeId}`,
        name: peer.name,
        baseUrl: `hub://${peer.nodeId}`,
        adapter: 'hub',
        path: null,
        tags: ['hub'],
        enabled: true,
        network: 'internet',
        notes: '',
        createdAt: new Date(peer.lastSeen).toISOString(),
        updatedAt: new Date(peer.lastSeen).toISOString(),
        hubFresh: fresh
      })
    }
    return rows
  }

  /** @param {any} peer */
  hubProbeRecord(peer) {
    const fresh = Date.now() - peer.lastSeen < 20_000
    return {
      status: fresh ? 'ok' : 'error',
      checkedAt: new Date(peer.lastSeen).toISOString(),
      lastSeenAt: new Date(peer.lastSeen).toISOString(),
      latencyMs: null,
      failures: fresh ? 0 : this.settings.offlineAfterFailures,
      error: fresh ? null : { code: 'offline', message: '远程节点失联' },
      protocolMismatch: false,
      snapshot: peer.payload
    }
  }

  /** 本地节点 + 远程主节点投影。 */
  allNodes() {
    return [...this.nodes, ...this.hubNodes()]
  }

  /** 本地探测记录 + 远程节点记录（原始形态，供 summarize/computeAlerts）。 */
  rawProbeMap() {
    const map = Object.fromEntries(this.probes)
    for (const peer of this.hubPeers.values()) map[`hub:${peer.nodeId}`] = this.hubProbeRecord(peer)
    return map
  }

  /* ---------------------------------------------------------------- */
  /* 节点代理 HTTP 端点                                                */
  /* ---------------------------------------------------------------- */

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {'status'|'health'} kind */
  async handleAgentRequest(req, res, kind) {
    const method = (req.method || 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
      return
    }
    const peer = req.socket?.remoteAddress || 'unknown'
    if (!this.requestAllowed(peer)) {
      sendJson(res, 429, { ok: false, error: 'rate-limited' })
      return
    }
    if (kind === 'health') {
      sendJson(res, 200, { ok: true, protocol: core.PROTOCOL, name: 'dsh-node-monitor' })
      return
    }
    const token = requestToken(req)
    if (!token || !core.compareTokens(token, this.secrets.agentToken)) {
      if (!this.noteAuthFailure(peer)) {
        sendJson(res, 429, { ok: false, error: 'rate-limited' })
        return
      }
      res.setHeader('www-authenticate', 'Bearer realm="dsh-node-monitor"')
      sendJson(res, 401, { ok: false, error: 'unauthorized' })
      return
    }
    this.authFails.delete(peer)
    try {
      const payload = await this.buildAgentPayload()
      sendJson(res, 200, payload)
    } catch (error) {
      this.logger.warn(`agent payload failed: ${error?.message ?? 'unknown'}`)
      sendJson(res, 500, { ok: false, error: 'internal' })
    }
  }

  requestAllowed(peer) {
    const now = Date.now()
    const entry = this.requestCounts.get(peer)
    if (!entry || now > entry.resetAt) {
      this.requestCounts.set(peer, { count: 1, resetAt: now + REQUEST_WINDOW_MS })
      return true
    }
    entry.count += 1
    return entry.count <= REQUEST_LIMIT
  }

  noteAuthFailure(peer) {
    const now = Date.now()
    const entry = this.authFails.get(peer)
    if (!entry || now > entry.resetAt) {
      this.authFails.set(peer, { count: 1, resetAt: now + AUTH_FAIL_WINDOW_MS })
      return true
    }
    entry.count += 1
    return entry.count <= AUTH_FAIL_LIMIT
  }

  /* ---------------------------------------------------------------- */
  /* RPC                                                               */
  /* ---------------------------------------------------------------- */

  async handleRpc(endpoint, payload, signal, peer) {
    const name = normalizeEndpoint(endpoint)
    try {
      // 未携带 principal 的调用一律视为非 owner：变更类端点必须显式由 owner 触发。
      const owner = peer?.principal?.kind === 'owner'
      const body = isObject(payload) ? payload : {}

      switch (name) {
        case 'state':
          return rpcOk(await this.buildState())
        case 'refresh':
          await this.probeAll()
          return rpcOk(await this.buildState())
        case 'addNode': {
          if (!owner) throw new RpcError('forbidden', '需要 owner 权限')
          return rpcOk(await this.addNode(body))
        }
        case 'updateNode': {
          if (!owner) throw new RpcError('forbidden', '需要 owner 权限')
          return rpcOk(await this.updateNode(body))
        }
        case 'removeNode': {
          if (!owner) throw new RpcError('forbidden', '需要 owner 权限')
          return rpcOk(await this.removeNode(body))
        }
        case 'ackAlert': {
          if (!owner) throw new RpcError('forbidden', '需要 owner 权限')
          return rpcOk(await this.ackAlert(body))
        }
        case 'batchNodes': {
          if (!owner) throw new RpcError('forbidden', '需要 owner 权限')
          return rpcOk(await this.batchNodes(body))
        }
        case 'ackAll': {
          if (!owner) throw new RpcError('forbidden', '需要 owner 权限')
          return rpcOk(await this.ackAll())
        }
        case 'settings': {
          if (!owner) throw new RpcError('forbidden', '需要 owner 权限')
          return rpcOk(await this.updateSettings(body))
        }
        case 'testNode':
          if (!owner) throw new RpcError('forbidden', '需要 owner 权限')
          return rpcOk(await this.testNode(body))
        case 'setLogin': {
          if (!owner) throw new RpcError('forbidden', '需要 owner 权限')
          return rpcOk(await this.setLogin(body))
        }
        case 'clearLogin': {
          if (!owner) throw new RpcError('forbidden', '需要 owner 权限')
          return rpcOk(await this.clearLogin(body))
        }
        case 'openTicket': {
          if (!owner) throw new RpcError('forbidden', '需要 owner 权限')
          const ticket = this.openTicket(body)
          return rpcOk(ticket)
        }
        case 'control': {
          if (!owner) throw new RpcError('forbidden', '需要 owner 权限')
          return rpcOk(await this.controlNode(body))
        }
        case 'hubJoin': {
          if (!owner) throw new RpcError('forbidden', '需要 owner 权限')
          const origin = this.hubBaseUrl()
          const link = core.encodeJoinLink(origin, this.secrets.hubToken)
          if (!link) throw new RpcError('join-link-invalid', '无法生成加入链接')
          const qr = qrcode(0, 'M')
          qr.addData(link)
          qr.make()
          return rpcOk({ link, origin, svg: qr.createSvgTag({ cellSize: 4, margin: 2 }) })
        }
        case 'hubInfo': {
          if (!owner) throw new RpcError('forbidden', '需要 owner 权限')
          return rpcOk({
            enabled: this.hubMode,
            origin: this.hubBaseUrl(),
            token: this.secrets.hubToken,
            peers: this.hubPeers.size,
            link: this.hubLink
          })
        }
        case 'hubConnect': {
          if (!owner) throw new RpcError('forbidden', '需要 owner 权限')
          return rpcOk(await this.connectHub(body))
        }
        case 'hubDisconnect': {
          if (!owner) throw new RpcError('forbidden', '需要 owner 权限')
          return rpcOk(await this.disconnectHub())
        }
        case 'hubRotateToken': {
          if (!owner) throw new RpcError('forbidden', '需要 owner 权限')
          if (body.confirm !== true) throw new RpcError('confirm-required', '重新生成加入令牌需要 confirm:true')
          this.secrets.hubToken = core.generatePairingToken()
          await this.writeSecrets()
          this.pushEvent('event.hubTokenRotated', 'security', {}, 'warn')
          return rpcOk({ token: this.secrets.hubToken })
        }
        case 'discoveryProbe': {
          if (!owner) throw new RpcError('forbidden', '需要 owner 权限')
          this.announceDiscovery()
          return rpcOk(await this.buildState())
        }
        case 'selfToken': {
          if (!owner) throw new RpcError('forbidden', '需要 owner 权限')
          return rpcOk(this.selfIdentity())
        }
        case 'rotateToken': {
          if (!owner) throw new RpcError('forbidden', '需要 owner 权限')
          if (body.confirm !== true) throw new RpcError('confirm-required', '重新生成令牌需要 confirm:true')
          this.secrets.agentToken = core.generatePairingToken()
          this.secrets.tokenSource = 'file'
          await this.writeSecrets()
          this.pushEvent('event.tokenRotated', 'security', {}, 'warn')
          return rpcOk(this.selfIdentity())
        }
        case 'updateLabel': {
          if (!owner) throw new RpcError('forbidden', '需要 owner 权限')
          const label = core.cleanText(body.label, 40)
          if (!label) throw new RpcError('label-invalid', '名称不能为空')
          this.nodeLabel = label
          this.secrets.nodeLabel = label
          await this.writeSecrets()
          this.announceDiscovery()
          return rpcOk(await this.buildState())
        }
        default:
          throw new RpcError('unknown-endpoint', `未知端点：${name || '(empty)'}`)
      }
    } catch (error) {
      const code = typeof error?.code === 'string' && /^[a-z0-9-]{1,40}$/i.test(error.code) ? error.code : 'internal'
      return {
        ok: false,
        error: {
          code: `node-monitor/${code}`,
          message: core.cleanText(error?.message ?? '未知错误', 300) || '未知错误',
          details: {}
        }
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* RPC 业务                                                          */
  /* ---------------------------------------------------------------- */

  async buildState() {
    const now = core.nowIso()
    const probes = {}
    for (const [id, record] of this.probes) {
      probes[id] = {
        status: core.classifyProbe(record, this.settings),
        checkedAt: record.checkedAt,
        lastSeenAt: record.lastSeenAt ?? (record.status === 'ok' ? record.checkedAt : null),
        latencyMs: record.latencyMs,
        failures: record.failures,
        error: record.error,
        protocolMismatch: Boolean(record.protocolMismatch),
        snapshot: record.snapshot ?? null
      }
    }
    for (const peer of this.hubPeers.values()) {
      const record = this.hubProbeRecord(peer)
      probes[`hub:${peer.nodeId}`] = {
        status: core.classifyProbe(record, this.settings),
        checkedAt: record.checkedAt,
        lastSeenAt: record.lastSeenAt,
        latencyMs: record.latencyMs,
        failures: record.failures,
        error: record.error,
        protocolMismatch: false,
        snapshot: record.snapshot
      }
    }
    const allNodes = this.allNodes()
    const rawProbes = this.rawProbeMap()
    const summary = core.summarize(allNodes, rawProbes, this.currentAlerts, this.settings)
    return {
      protocol: core.PROTOCOL,
      generatedAt: now,
      startedAt: this.startedAt,
      settings: this.settings,
      token: {
        agentEndpointEnabled: Boolean(this.secrets.agentToken),
        source: this.secrets.tokenSource
      },
      server: {
        hostname: os.hostname(),
        platform: process.platform,
        arch: process.arch,
        uptimeSec: Math.round(os.uptime()),
        origin: safeOrigin(this.hostCtx ?? this.ctx)
      },
      nodes: allNodes.map((node) => ({
        ...publicNode(node),
        hasToken: this.hasNodeToken(node),
        login: core.maskLogin(this.loginFor(node.id))
      })),
      probes,
      alerts: this.currentAlerts,
      events: this.events.slice(0, Math.max(5, this.settings.eventsLimit)),
      summary,
      self: {
        id: this.secrets.nodeId || '',
        shortId: core.shortNodeId(this.secrets.nodeId || ''),
        label: this.nodeLabel,
        origin: safeOrigin(this.hostCtx ?? this.ctx)
      },
      discovery: this.discoverySnapshot(),
      hub: {
        enabled: this.hubMode,
        origin: this.hubBaseUrl(),
        peers: this.hubPeers.size,
        link: this.hubLink ? { url: this.hubLink.url, lastOk: this.hubLastOk || null } : null
      }
    }
  }

  hubBaseUrl() {
    return this.publicUrl || safeOrigin(this.hostCtx ?? this.ctx)
  }

  hasNodeToken(node) {
    if (Array.isArray(node.tags) && node.tags.includes('self')) return Boolean(this.secrets.agentToken)
    const token = this.secrets.nodeTokens[node.id]
    return typeof token === 'string' && token.length > 0
  }

  async addNode(body) {
    const validated = core.validateNodeInput(body)
    if (!validated.ok) throw new RpcError(validated.error.code, validated.error.message)
    const now = core.nowIso()
    const node = {
      id: `n-${randomUUID().slice(0, 8)}`,
      name: validated.value.name,
      baseUrl: validated.value.baseUrl,
      adapter: validated.value.adapter,
      path: validated.value.path,
      tags: validated.value.tags,
      enabled: validated.value.enabled !== false,
      network: validated.value.network,
      notes: validated.value.notes,
      createdAt: now,
      updatedAt: now
    }
    if (!this.canAdd(null)) throw new RpcError('limit-reached', '节点数量已达上限（64）')
    if (!node.name) node.name = await this.resolveNodeName(node, validated.value.token)
    this.nodes = [...this.nodes, node]
    if (validated.value.token) {
      this.secrets.nodeTokens[node.id] = validated.value.token
      await this.writeSecrets()
    }
    this.pushEvent('event.nodeAdded', 'node', { name: node.name, id: node.id }, 'info')
    await this.saveNow()
    if (validated.value.token) void this.announcePairing(node)
    await this.probeNode(node)
    return this.buildState()
  }

  /** 名称留空时：优先取远端 /status 的 hostname，失败则退回地址里的 host。 */
  async resolveNodeName(node, token) {
    const fallback = (() => {
      try {
        return new URL(node.baseUrl).host
      } catch {
        return 'node'
      }
    })()
    try {
      const outcome = await core.probeEndpoint({
        node,
        token: token || null,
        timeoutMs: Math.min(2000, this.settings.timeoutMs),
        fetchImpl: fetch,
        expectedProtocol: core.PROTOCOL
      })
      const hostname = core.cleanText(outcome?.probe?.snapshot?.host?.hostname, 64)
      if (outcome?.ok && hostname) return hostname
    } catch {
      /* probe is best-effort */
    }
    return fallback
  }

  /** 把本机登记到刚接入的节点上（双向桥）。只在用户主动添加/更新且带令牌时触发。 */
  async announcePairing(node) {
    if (!node || !this.serverPort) return
    if (Array.isArray(node.tags) && node.tags.includes('self')) return
    const token = this.secrets.nodeTokens[node.id]
    if (!token) return
    const body = {
      id: this.secrets.nodeId,
      label: this.nodeLabel,
      port: this.serverPort,
      token: this.secrets.agentToken
    }
    try {
      const response = await fetch(`${node.baseUrl}${core.PAIR_PATH}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.max(2000, this.settings.timeoutMs))
      })
      if (response.ok) {
        this.pushEvent('event.nodePaired', 'node', { name: node.name }, 'info')
      }
    } catch {
      /* 对端未开启配对/不可达时静默；节点本身仍可单向使用 */
    }
  }

  /** 接收对端推送过来的「我也把你加上」请求（Bearer 为本站 agent token）。 */
  async handlePairRequest(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
      return
    }
    const ip = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '')
    if (!core.isLanAddress(ip)) {
      sendJson(res, 403, { ok: false, error: 'address-not-allowed' })
      return
    }
    let raw
    try {
      raw = await readBody(req, 16 * 1024)
    } catch {
      sendJson(res, 413, { ok: false, error: 'body-too-large' })
      return
    }
    let body
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      sendJson(res, 400, { ok: false, error: 'bad-json' })
      return
    }
    const automatic = body.auto === true && this.autoPair
    if (!automatic) {
      const token = requestToken(req)
      if (!token || !core.compareTokens(token, this.secrets.agentToken)) {
        res.setHeader('www-authenticate', 'Bearer realm="dsh-node-monitor"')
        sendJson(res, 401, { ok: false, error: 'unauthorized' })
        return
      }
    }
    const validated = core.validatePairRequest(body)
    if (!validated.ok) {
      sendJson(res, 400, { ok: false, error: validated.error.code })
      return
    }
    try {
      const targetPort = validated.value.agentPort || validated.value.port
      const host = ip.includes(':') ? `[${ip}]` : ip
      const baseUrl = `http://${host}:${targetPort}`
      const name = validated.value.label || `peer-${ip}`
      const existing = this.nodes.find((item) => item.baseUrl === baseUrl)
      const reply = {
        ok: true,
        token: this.secrets.agentToken,
        agentPort: this.agentPort,
        label: this.nodeLabel
      }
      if (existing) {
        existing.name = existing.name || name
        this.secrets.nodeTokens[existing.id] = validated.value.token
        existing.updatedAt = core.nowIso()
        await this.saveNow()
        await this.writeSecrets()
        this.pushEvent('event.nodePaired', 'node', { name: existing.name }, 'info')
        sendJson(res, 200, { ...reply, nodeId: existing.id, updated: true })
        return
      }
      if (!this.canAdd(null)) {
        sendJson(res, 409, { ok: false, error: 'limit-reached' })
        return
      }
      const now = core.nowIso()
      const node = {
        id: `n-${randomUUID().slice(0, 8)}`,
        name,
        baseUrl,
        adapter: 'dsh',
        path: null,
        tags: automatic ? ['paired', 'auto'] : ['paired'],
        enabled: true,
        network: 'lan',
        notes: '',
        createdAt: now,
        updatedAt: now
      }
      this.nodes = [...this.nodes, node]
      this.secrets.nodeTokens[node.id] = validated.value.token
      await this.writeSecrets()
      this.pushEvent(automatic ? 'event.nodeAutoPaired' : 'event.nodePaired', 'node', { name: node.name }, 'info')
      await this.saveNow()
      void this.probeNode(node)
      sendJson(res, 200, { ...reply, nodeId: node.id, created: true })
    } catch (error) {
      this.logger.warn(`pair failed: ${error?.message ?? error}`)
      sendJson(res, 500, { ok: false, error: 'pair-failed' })
    }
  }

  canAdd(exceptId) {
    const count = this.nodes.filter((node) => node.id !== exceptId).length
    return count < 64
  }

  async updateNode(body) {
    const id = core.cleanText(body.id, 64)
    const existing = this.nodes.find((node) => node.id === id)
    if (!existing) throw new RpcError('not-found', '节点不存在')
    const validated = core.validateNodeInput(body, { isUpdate: true })
    if (!validated.ok) throw new RpcError(validated.error.code, validated.error.message)
    if (validated.value.name) existing.name = validated.value.name
    existing.baseUrl = validated.value.baseUrl
    existing.adapter = validated.value.adapter
    existing.path = validated.value.path
    existing.tags = validated.value.tags
    existing.enabled = validated.value.enabled
    existing.network = validated.value.network
    existing.notes = validated.value.notes
    existing.updatedAt = core.nowIso()
    if (validated.value.token) {
      this.secrets.nodeTokens[id] = validated.value.token
      await this.writeSecrets()
    }
    if (body.clearToken === true) {
      delete this.secrets.nodeTokens[id]
      await this.writeSecrets()
    }
    if (!existing.enabled) {
      this.probes.delete(id)
    }
    await this.saveNow()
    if (validated.value.token) void this.announcePairing(existing)
    if (existing.enabled) await this.probeNode(existing)
    return this.buildState()
  }

  async removeNode(body) {
    const id = core.cleanText(body.id, 64)
    const existing = this.nodes.find((node) => node.id === id)
    if (!existing) throw new RpcError('not-found', '节点不存在')
    this.nodes = this.nodes.filter((node) => node.id !== id)
    this.probes.delete(id)
    if (this.secrets.nodeTokens[id]) {
      delete this.secrets.nodeTokens[id]
    }
    if (this.secrets.nodeLogins[id]) {
      delete this.secrets.nodeLogins[id]
    }
    await this.writeSecrets()
    this.pushEvent('event.nodeRemoved', 'node', { name: existing.name, id }, 'info')
    await this.saveNow()
    this.recomputeAlerts()
    return this.buildState()
  }

  async ackAlert(body) {
    const key = core.cleanText(body.key, 120)
    if (!key || !this.currentAlerts.some((alert) => alert.key === key)) {
      throw new RpcError('not-found', '告警已恢复或不存在')
    }
    this.acks[key] = core.nowIso()
    this.recomputeAlerts()
    this.saveSoon()
    return this.buildState()
  }

  /**
   * Apply one batch operation (enable/disable/probe) over selected nodes.
   * @param {any} body
   * @returns {Promise<any>}
   */
  async batchNodes(body) {
    const parsed = core.validateBatchRequest(body)
    if (!parsed.ok) throw new RpcError(parsed.error.code, parsed.error.message)
    const targets = this.nodes.filter((node) => parsed.value.ids.includes(node.id))
    if (targets.length === 0) throw new RpcError('node-not-found', '所选节点不存在')
    if (parsed.value.op === 'probe') {
      await Promise.all(targets.map((node) => this.probeNode(node)))
      this.recomputeAlerts()
      this.pushEvent('event.batchProbed', 'batch', { count: targets.length }, 'info')
    } else {
      const enabled = parsed.value.op === 'enable'
      for (const node of targets) node.enabled = enabled
      this.recomputeAlerts()
      await this.saveNow()
      this.pushEvent(enabled ? 'event.batchEnabled' : 'event.batchDisabled', 'batch', { count: targets.length }, enabled ? 'info' : 'warn')
    }
    return this.buildState()
  }

  async ackAll() {
    for (const alert of this.currentAlerts) {
      this.acks[alert.key] = core.nowIso()
    }
    this.recomputeAlerts()
    this.saveSoon()
    return this.buildState()
  }

  async updateSettings(body) {
    this.settings = core.clampSettings(body, this.settings)
    await this.saveNow()
    if (this.tickTimer) {
      clearTimeout(this.tickTimer)
      this.tickTimer = null
    }
    if (!this.disposed) {
      this.tickTimer = setTimeout(() => this.tick(), 200)
    }
    return this.buildState()
  }

  /* ---------------------------------------------------------------- */
  /* Hub：登录材料与一次性打开票据                                       */
  /* ---------------------------------------------------------------- */

  /** @param {string} id */
  loginFor(id) {
    const url = this.secrets.nodeLogins[id]
    if (typeof url !== 'string' || !url) return null
    const parsed = core.parseLoginUrl(url)
    return parsed.ok ? parsed.value : null
  }

  /** 保存 / 覆盖节点的 DSH 登录地址；空值等价于清除。 */
  async setLogin(body) {
    const id = core.cleanText(body.id, 64)
    const node = this.nodes.find((item) => item.id === id)
    if (!node) throw new RpcError('not-found', '节点不存在')
    if (typeof body.url !== 'string' || !body.url.trim()) {
      throw new RpcError('login-url-invalid', '登录地址不能为空')
    }
    const parsed = core.parseLoginUrl(body.url)
    if (!parsed.ok) throw new RpcError(parsed.error.code, parsed.error.message)
    this.secrets.nodeLogins[id] = parsed.value.url
    await this.writeSecrets()
    node.updatedAt = core.nowIso()
    await this.saveNow()
    this.pushEvent('event.loginSaved', 'node', { name: node.name, id }, 'info')
    return this.buildState()
  }

  async clearLogin(body) {
    const id = core.cleanText(body.id, 64)
    const node = this.nodes.find((item) => item.id === id)
    if (!node) throw new RpcError('not-found', '节点不存在')
    if (this.secrets.nodeLogins[id]) {
      delete this.secrets.nodeLogins[id]
      await this.writeSecrets()
      this.pushEvent('event.loginCleared', 'node', { name: node.name, id }, 'info')
    }
    return this.buildState()
  }

  /**
   * 生成一次性打开票据：绑定节点 id、60 秒过期、nonce 只用一次。
   * 票据只用于「浏览器导航」，不携带节点令牌，也不进入任何日志。
   */
  openTicket(body) {
    const id = core.cleanText(body.id, 64)
    const node = this.nodes.find((item) => item.id === id)
    if (!node) throw new RpcError('not-found', '节点不存在')
    if (!node.enabled) throw new RpcError('disabled', '节点已停用')
    const now = Date.now()
    this.pruneOpenNonces(now)
    const nonce = randomBytes(9).toString('base64url')
    const expiresAt = now + 60_000
    this.openNonces.set(nonce, expiresAt)
    const payload = Buffer.from(JSON.stringify({ id, exp: expiresAt, n: nonce })).toString('base64url')
    const signature = createHmac('sha256', this.secrets.openSecret).update(payload).digest('base64url')
    const ticket = `${payload}.${signature}`
    return {
      nodeId: id,
      url: `${core.OPEN_PATH}?id=${encodeURIComponent(id)}&t=${encodeURIComponent(ticket)}`,
      expiresAt: new Date(expiresAt).toISOString(),
      hasLogin: Boolean(this.loginFor(id))
    }
  }

  /** @param {number} now */
  pruneOpenNonces(now) {
    for (const [nonce, exp] of this.openNonces) {
      if (exp <= now) this.openNonces.delete(nonce)
    }
    // 兜底：极端情况下票据堆积，保留最近 200 个。
    if (this.openNonces.size > 200) {
      const keep = [...this.openNonces.entries()].sort((a, b) => a[1] - b[1]).slice(-200)
      this.openNonces = new Map(keep)
    }
  }

  /**
   * GET /node-monitor/open?id=&t=
   * 校验签名 + 过期 + 一次性 nonce，然后 302 到节点的 DSH 登录地址。
   * 这是 raw 路由，必须完全自校验，不能依赖 DSH 的 Cookie 认证。
   */
  handleOpenRequest(req, res) {
    const send = (status, message) => {
      try {
        res.writeHead(status, {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff'
        })
        res.end(message)
      } catch {
        /* 客户端可能已断开 */
      }
    }
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'method not allowed')
      const url = new URL(String(req.url || ''), 'http://localhost')
      const id = core.cleanText(url.searchParams.get('id'), 64)
      const ticket = String(url.searchParams.get('t') || '')
      const verified = this.verifyOpenTicket(ticket, id)
      if (!verified) return send(403, 'invalid or expired ticket')
      const node = this.nodes.find((item) => item.id === verified.id)
      if (!node || !node.enabled) return send(404, 'node not found')
      const login = this.loginFor(node.id)
      const target = login?.url || node.baseUrl
      if (!target) return send(500, 'node has no login url')
      res.writeHead(302, {
        location: target,
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer'
      })
      res.end()
    } catch (error) {
      this.logger.warn(`open route failed: ${error?.message ?? 'unknown'}`)
      return send(500, 'open failed')
    }
  }

  /** @param {string} ticket @param {string} expectedId */
  verifyOpenTicket(ticket, expectedId) {
    if (!ticket || !ticket.includes('.') || ticket.length > 2000) return null
    const index = ticket.lastIndexOf('.')
    const payload = ticket.slice(0, index)
    const signature = ticket.slice(index + 1)
    let expected
    try {
      expected = createHmac('sha256', this.secrets.openSecret).update(payload).digest('base64url')
    } catch {
      return null
    }
    const a = Buffer.from(signature)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    let data
    try {
      data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    } catch {
      return null
    }
    if (!data || typeof data !== 'object') return null
    if (typeof data.id !== 'string' || data.id !== expectedId) return null
    if (typeof data.exp !== 'number' || data.exp <= Date.now()) return null
    if (typeof data.n !== 'string' || !data.n) return null
    if (!this.openNonces.has(data.n)) return null
    this.openNonces.delete(data.n)
    return { id: data.id }
  }

  /* ---------------- 运维控制（默认关闭） ---------------- */

  /**
   * 节点侧运维入口。POST + Bearer；动作白名单见 core.CONTROL_ACTIONS。
   * 先写审计再执行，审计失败不阻塞（但会记日志）。
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async handleControlRequest(req, res) {
    const method = (req.method || 'GET').toUpperCase()
    if (method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
      return
    }
    const peer = req.socket?.remoteAddress || 'unknown'
    if (!this.requestAllowed(peer)) {
      sendJson(res, 429, { ok: false, error: 'rate-limited' })
      return
    }
    const token = requestToken(req)
    if (!token || !core.compareTokens(token, this.secrets.agentToken)) {
      if (!this.noteAuthFailure(peer)) {
        sendJson(res, 429, { ok: false, error: 'rate-limited' })
        return
      }
      res.setHeader('www-authenticate', 'Bearer realm="dsh-node-monitor"')
      sendJson(res, 401, { ok: false, error: 'unauthorized' })
      return
    }
    this.authFails.delete(peer)
    if (!this.allowControl) {
      sendJson(res, 403, { ok: false, error: 'control-disabled' })
      return
    }
    const raw = await readBody(req, 64 * 1024)
    if (raw === null) {
      sendJson(res, 413, { ok: false, error: 'payload-too-large' })
      return
    }
    let body
    try {
      body = raw.trim() ? JSON.parse(raw) : {}
    } catch {
      sendJson(res, 400, { ok: false, error: 'bad-json' })
      return
    }
    const checked = core.validateControlRequest(body, { allowRestart: this.allowRestart })
    if (!checked.ok) {
      await this.appendAudit({ action: core.cleanText(body?.action, 40) || 'unknown', dryRun: true, confirm: false, ok: false, error: checked.error.code })
      sendJson(res, 400, { ok: false, error: checked.error.code, message: checked.error.message })
      return
    }
    const request = checked.value
    await this.appendAudit({
      action: request.action,
      dryRun: request.dryRun,
      confirm: request.confirm,
      params: request.params,
      ok: null
    })
    try {
      const result = await this.dispatchControl(request)
      await this.appendAudit({
        action: request.action,
        dryRun: request.dryRun,
        confirm: request.confirm,
        params: request.params,
        ok: true
      })
      if (request.action === 'restart') {
        sendJson(res, 202, { ok: true, restarting: true })
        setTimeout(() => {
          try {
            process.exit(0)
          } catch {
            /* ignore */
          }
        }, 150).unref?.()
        return
      }
      sendJson(res, 200, { ok: true, action: request.action, dryRun: request.dryRun, value: result })
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : 'control-failed'
      await this.appendAudit({ action: request.action, dryRun: request.dryRun, confirm: request.confirm, params: request.params, ok: false, error: code })
      sendJson(res, 500, { ok: false, error: code, message: error?.message ?? 'control failed' })
    }
  }

  /** @param {{ action: string, params: any, dryRun: boolean, confirm: boolean }} request */
  async dispatchControl(request) {
    const manager = this.ctx.get('pluginManager')
    if (!manager) throw Object.assign(new Error('宿主未提供 pluginManager 服务'), { code: 'control-unavailable' })
    if (request.action === 'plugins.list') {
      const list = await manager.listPlugins()
      const rows = (Array.isArray(list) ? list : [])
        .map((item) => ({
          id: core.cleanText(item?.entryId, 120),
          name: core.cleanText(item?.meta?.title || item?.moduleName, 120),
          moduleName: core.cleanText(item?.moduleName, 120),
          enabled: item?.enabled !== false,
          manageable: Boolean(item?.patchId),
          readOnly: item?.readOnlyReason ? core.cleanText(item.readOnlyReason, 60) : ''
        }))
        .filter((item) => Boolean(item.id) && Boolean(item.moduleName))
        .sort((a, b) => Number(b.manageable) - Number(a.manageable) || a.moduleName.localeCompare(b.moduleName))
        .slice(0, 60)
      return { items: rows }
    }
    if (request.action === 'bundles.list') {
      const list = await manager.listBundles()
      return {
        items: (Array.isArray(list) ? list : []).slice(0, 100).map((item) => ({
          name: core.cleanText(item?.name, 120),
          official: item?.official === true,
          availability: core.cleanText(item?.availability, 40)
        }))
      }
    }
    if (request.action === 'plugins.setEnabled') {
      const { id, enabled } = request.params
      if (request.dryRun) return { plan: { id, enabled } }
      const result = await manager.setPluginEnabled(id, enabled)
      return { changed: true, result: core.jsonSafe(result) || {} }
    }
    throw Object.assign(new Error('unsupported action'), { code: 'control-action-invalid' })
  }

  /** 逐行追加审计（0600，绝不含令牌）。 @param {Record<string, unknown>} entry */
  async appendAudit(entry) {
    try {
      const line = JSON.stringify({
        ts: core.nowIso(),
        ...entry,
        params: core.jsonSafe(entry.params ?? {}) || {}
      })
      await fsp.mkdir(this.dir, { recursive: true, mode: 0o700 })
      await fsp.appendFile(this.auditFile, `${line}\n`, { mode: 0o600 })
    } catch (error) {
      this.logger.warn(`audit append failed: ${error?.message ?? 'unknown'}`)
    }
  }

  /**
   * Hub 侧：向某个节点转发运维动作。节点未启用时返回 control-disabled。
   * @param {Record<string, any>} body
   */
  async controlNode(body) {
    const id = core.cleanText(body.id, 64)
    if (id.startsWith('hub:')) return this.controlHubNode(id.slice(4), body)
    const node = this.nodes.find((item) => item.id === id)
    if (!node) throw new RpcError('not-found', '节点不存在')
    const token = await this.tokenForNode(node)
    if (!token) throw new RpcError('no-token', '该节点未配置令牌')
    const action = core.cleanText(body.action, 40)
    if (!core.CONTROL_ACTIONS.includes(action)) throw new RpcError('control-action-invalid', '未知的运维动作')
    const target = core.joinUrl(node.baseUrl, core.CONTROL_PATH)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.settings.timeoutMs)
    try {
      const response = await fetch(target, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          params: core.jsonSafe(body.params ?? {}) || {},
          dryRun: body.dryRun !== false,
          confirm: body.confirm === true
        }),
        redirect: 'error',
        signal: controller.signal
      })
      const text = await response.text()
      let payload = null
      try {
        payload = JSON.parse(text)
      } catch {
        payload = { ok: false, error: 'bad-json' }
      }
      this.pushEvent('event.control', 'control', { name: node.name, action }, 'info')
      return { status: response.status, response: payload }
    } catch (error) {
      const aborted = error?.name === 'AbortError'
      throw new RpcError(aborted ? 'timeout' : 'unreachable', aborted ? '节点响应超时' : '无法连接节点')
    } finally {
      clearTimeout(timer)
    }
  }

  async testNode(body) {
    let node = null
    let token = ''
    const id = core.cleanText(body.id, 64)
    if (id) {
      const existing = this.nodes.find((item) => item.id === id)
      if (!existing) throw new RpcError('not-found', '节点不存在')
      node = existing
      token = await this.tokenForNode(existing)
      if (typeof body.token === 'string' && body.token.trim()) token = body.token.trim()
    } else {
      const validated = core.validateNodeInput(body)
      if (!validated.ok) throw new RpcError(validated.error.code, validated.error.message)
      node = {
        adapter: validated.value.adapter,
        baseUrl: validated.value.baseUrl,
        path: validated.value.path
      }
      token = typeof body.token === 'string' ? body.token.trim() : ''
    }
    const outcome = await core.probeEndpoint({ node, token, timeoutMs: this.settings.timeoutMs })
    return {
      success: outcome.ok,
      latencyMs: outcome.probe.latencyMs,
      error: outcome.probe.error,
      snapshot: outcome.probe.snapshot,
      checkedAt: outcome.probe.checkedAt
    }
  }
}

/* ------------------------------------------------------------------ */
/* 辅助                                                                */
/* ------------------------------------------------------------------ */

/** @param {unknown} value */
function isoTime(value) {
  if (value === null || value === undefined || value === '') return ''
  const date = value instanceof Date ? value : new Date(value)
  const ms = date instanceof Date ? date.getTime() : NaN
  return Number.isFinite(ms) ? new Date(ms).toISOString() : ''
}

function shortId(value) {
  if (typeof value !== 'string' || value.length === 0) return ''
  const tail = value.startsWith('session-') ? value.slice('session-'.length) : value
  return tail.slice(0, 8)
}

/** @param {any} ctx */
function safeOrigin(ctx) {
  try {
    const advertised = ctx.get('webApp')?.getAdvertisedUrl?.()
    if (typeof advertised === 'string' && /^https?:\/\//i.test(advertised)) {
      return advertised.replace(/\/+$/, '')
    }
  } catch {
    // webApp is optional; fall back to the web server origin
  }
  try {
    return String(ctx.webServer.getOrigin() || '')
  } catch {
    return ''
  }
}

/** @param {any} node */
function publicNode(node) {
  return {
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
  }
}

/** @param {unknown} value */
function rpcOk(value) {
  return { ok: true, value }
}
