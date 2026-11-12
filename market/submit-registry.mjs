#!/usr/bin/env node
// Submit this plugin to awesome-dsh-plugin/awesome-dsh-plugin.
// Usage: GITHUB_TOKEN=ghp_xxx node market/submit-registry.mjs
// Token needs: public_repo (or repo) scope on qingshuiliuyun account.
// The script forks the registry, adds data/plugins/qingshuiliuyun__dsh-node-monitor.yml
// on a branch, opens the PR, and sets the `dsh-plugin` topic on our repo.
import fs from 'node:fs'
import path from 'node:path'

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
if (!TOKEN) { console.error('missing GITHUB_TOKEN (PAT with public_repo scope)'); process.exit(1) }
const OWNER = 'qingshuiliuyun'
const REPO = 'dsh-node-monitor'
const UPSTREAM = 'awesome-dsh-plugin/awesome-dsh-plugin'
const BRANCH = 'add-dsh-node-monitor'
const ENTRY = `data/plugins/${OWNER}__${REPO}.yml`
const api = async (method, url, body) => {
  const res = await fetch(`https://api.github.com${url}`, {
    method,
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${TOKEN}`, 'user-agent': 'dsh-node-monitor-submit' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null; try { json = text ? JSON.parse(text) : null } catch {}
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text.slice(0, 300)}`)
  return json
}
const entry = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'entry.yml'), 'utf8')

// 1. fork
let fork = await api('POST', `/repos/${UPSTREAM}/forks`, { default_branch_only: true })
console.log('fork:', fork.full_name)
for (let i = 0; i < 30; i++) {
  const f = await api('GET', `/repos/${OWNER}/${UPSTREAM.split('/')[1]}`)
  if (f.full_name) { fork = f; break }
  await new Promise(r => setTimeout(r, 2000))
}
const forkRepo = `${OWNER}/${UPSTREAM.split('/')[1]}`
// 2. fork head sha
const base = await api('GET', `/repos/${forkRepo}/git/ref/heads/${fork.default_branch}`)
// 3. branch
let ref = null
try { ref = await api('GET', `/repos/${forkRepo}/git/ref/heads/${BRANCH}`) } catch {}
if (!ref) {
  ref = await api('POST', `/repos/${forkRepo}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: base.object.sha })
  console.log('branch created:', BRANCH)
}
// 4. put file
try { await api('PUT', `/repos/${forkRepo}/contents/${ENTRY}`, { message: `add: ${OWNER}/${REPO}`, content: Buffer.from(entry).toString('base64'), branch: BRANCH }) }
catch (e) { if (/already exists|sha.*required|422/.test(e.message)) console.log('entry already on branch (ok)'); else throw e }
// 5. PR
const body = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'pr-body.md'), 'utf8')
const pr = await api('POST', `/repos/${UPSTREAM}/pulls`, {
  title: `add: ${OWNER}/${REPO}`, head: `${OWNER}:${BRANCH}`, base: 'main', body,
})
console.log('PR:', pr.html_url)
// 6. topic on our repo
await api('PUT', `/repos/${OWNER}/${REPO}/topics`, { names: ['dsh', 'dsh-plugin', 'dsh-bundle', 'monitor', 'multi-node', 'dashboard', 'cordis'] })
console.log('topic dsh-plugin set')
