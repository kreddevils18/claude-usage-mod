#!/usr/bin/env node
// Incrementally aggregates Claude Code transcript usage (~/.claude/projects/**/*.jsonl)
// into a small summary the mod reads:
//   ~/.claude/claude-usage-mod/usage.json        summary (today / yesterday / 30d / trend)
//   ~/.claude/claude-usage-mod/usage-state.json  scan state (per-file offsets, dedupe keys, daily buckets)
//
// Each run reads only bytes appended since the last run. Records are deduped by
// message id because Claude Code writes one line per content block of a response and
// resumed sessions copy earlier messages into new files.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = parseArgs(process.argv.slice(2))
const HOME = os.homedir()
const PROJECTS = args.projects ?? path.join(HOME, '.claude', 'projects')
const OUT_DIR = args.outDir ?? path.join(HOME, '.claude', 'claude-usage-mod')
const PRICING_PATH = args.pricing ?? path.join(HERE, '..', 'config', 'pricing.json')
const SUMMARY_PATH = path.join(OUT_DIR, 'usage.json')
const STATE_PATH = path.join(OUT_DIR, 'usage-state.json')
const LOCK_PATH = path.join(OUT_DIR, 'usage.lock')
const KEEP_DAYS = 35
// Bumped when the state's shape changes; an older state is dropped and rescanned.
const STATE_VERSION = 2
const MTOK = 1_000_000

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[i + 1]
  return out
}

// `--now <iso>` pins the clock so tests do not depend on the day they run.
const NOW = args.now ? new Date(args.now) : new Date()
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const daysAgoKey = n => { const d = new Date(NOW); d.setDate(d.getDate() - n); return dayKey(d) }

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value))
  fs.renameSync(tmp, file)
}

// A second run (the mod's timer, a manual run) must not scan concurrently.
function acquireLock() {
  try {
    const age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs
    if (age < 5 * 60_000) return false
  } catch { /* no lock */ }
  fs.writeFileSync(LOCK_PATH, String(process.pid))
  return true
}

function listTranscripts(root, minMtimeMs) {
  const found = []
  const walk = dir => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith('.jsonl')) {
        let st
        try { st = fs.statSync(full) } catch { continue } // deleted since the listing
        if (st.mtimeMs >= minMtimeMs) found.push({ file: full, size: st.size })
      }
    }
  }
  walk(root)
  return found
}

const pricing = readJson(PRICING_PATH, { models: [], fallback: null })
const priceRules = pricing.models.map(m => ({ ...m, re: new RegExp(m.match) }))
const unknownModels = new Set()

function priceFor(model) {
  const hit = priceRules.find(r => r.re.test(model))
  if (hit) return hit
  unknownModels.add(model)
  return pricing.fallback
}

function costOf(model, u) {
  const p = priceFor(model)
  if (!p) return 0
  const cc = u.cache_creation ?? {}
  const w1h = cc.ephemeral_1h_input_tokens ?? 0
  // Without the 5m/1h split, price the whole cache write as 5m.
  const w5m = cc.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1h)
  return (
    ((u.input_tokens ?? 0) * p.input +
      (u.output_tokens ?? 0) * p.output +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead +
      w5m * p.input * (p.cacheWrite5mX ?? 1.25) +
      w1h * p.input * (p.cacheWrite1hX ?? 2)) /
    MTOK
  )
}

function addRecord(state, rec) {
  const msg = rec.message
  const u = msg?.usage
  if (!u || !rec.timestamp || !msg.model || msg.model === '<synthetic>') return
  const key = (msg.id ?? '').slice(-14) + (rec.requestId ?? '').slice(-8)
  if (key.length < 10 || state.seen[key]) return
  const day = dayKey(new Date(rec.timestamp))
  if (day < state.cutoff) return
  state.seen[key] = day
  const b = (state.daily[day] ??= { usd: 0, tokens: 0 })
  b.usd += costOf(msg.model, u)
  b.tokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
}

// Reads whole lines from `offset`; returns the offset after the last complete line.
function scanFile(state, file, offset) {
  const fd = fs.openSync(file, 'r')
  const chunk = Buffer.allocUnsafe(1 << 20)
  let pos = offset
  let carry = Buffer.alloc(0)
  try {
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, pos)
      if (n === 0) break
      pos += n
      let buf = carry.length ? Buffer.concat([carry, chunk.subarray(0, n)]) : chunk.subarray(0, n)
      let start = 0
      for (let nl = buf.indexOf(10, start); nl !== -1; nl = buf.indexOf(10, start)) {
        const line = buf.toString('utf8', start, nl)
        start = nl + 1
        if (line.includes('"usage"') && line.includes('"output_tokens"')) {
          try { addRecord(state, JSON.parse(line)) } catch { /* torn or foreign line */ }
        }
      }
      carry = Buffer.from(buf.subarray(start))
    }
  } finally {
    fs.closeSync(fd)
  }
  return pos - carry.length
}

function summarize(state) {
  const sum = (from, to) => {
    let usd = 0, tokens = 0
    for (const [day, b] of Object.entries(state.daily)) {
      if (day >= from && day <= to) { usd += b.usd; tokens += b.tokens }
    }
    return { usd: round2(usd), tokens }
  }
  const today = daysAgoKey(0)
  const trend = Array.from({ length: 14 }, (_, i) => {
    const day = daysAgoKey(13 - i)
    return { day, usd: round2(state.daily[day]?.usd ?? 0) }
  })
  return {
    updatedAt: NOW.getTime(),
    today: sum(today, today),
    yesterday: sum(daysAgoKey(1), daysAgoKey(1)),
    last30: sum(daysAgoKey(29), today),
    trend,
    unknownModels: [...unknownModels],
  }
}

// Scan offsets are keyed by a hash, so the state never holds a transcript's path
// (which names the user's project folders).
const fileKey = file => crypto.createHash('sha1').update(file).digest('hex').slice(0, 16)

const round2 = n => Math.round(n * 100) / 100

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  if (!acquireLock()) { console.error('another aggregation is running'); process.exit(0) }
  try {
    const cutoff = daysAgoKey(KEEP_DAYS)
    let state = readJson(STATE_PATH, null)
    if (!state || state.version !== STATE_VERSION) state = { version: STATE_VERSION, files: {}, seen: {}, daily: {} }
    state.cutoff = cutoff

    const minMtime = NOW.getTime() - KEEP_DAYS * 86_400_000
    const live = new Set()
    for (const { file, size } of listTranscripts(PROJECTS, minMtime)) {
      const key = fileKey(file)
      live.add(key)
      const prev = state.files[key]
      const offset = prev && prev.offset <= size ? prev.offset : 0
      if (prev && offset === size) continue
      try { state.files[key] = { offset: scanFile(state, file, offset) } } catch { live.delete(key) } // unreadable now: retry next run
    }

    for (const f of Object.keys(state.files)) if (!live.has(f)) delete state.files[f]
    for (const [k, day] of Object.entries(state.seen)) if (day < cutoff) delete state.seen[k]
    for (const day of Object.keys(state.daily)) if (day < cutoff) delete state.daily[day]

    delete state.cutoff
    writeJsonAtomic(STATE_PATH, state)
    const summary = summarize(state)
    writeJsonAtomic(SUMMARY_PATH, summary)
    process.stdout.write(JSON.stringify(summary) + '\n')
  } finally {
    try { fs.unlinkSync(LOCK_PATH) } catch { /* already gone */ }
  }
}

main()
