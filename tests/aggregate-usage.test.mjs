// Tests for scripts/aggregate-usage.mjs against small fixture transcripts.
// Run: node --test tests/
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'aggregate-usage.mjs')
// 12:00 on 3 Oct 2026 in Asia/Saigon (UTC+7). The script buckets by local day, so TZ is pinned too.
const NOW = '2026-10-03T05:00:00Z'
const TZ = 'Asia/Saigon'

let root, projects, out

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-mod-test-'))
  projects = path.join(root, 'projects', 'demo')
  out = path.join(root, 'out')
  fs.mkdirSync(projects, { recursive: true })
})

afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

// opus-5-5 is $4 in, $20 out, $0.20 cache read per MTok; cache writes are 1.25x (5m) and 2x (1h) of input.
const USAGE = {
  input_tokens: 1000,
  output_tokens: 500,
  cache_read_input_tokens: 10_000,
  cache_creation_input_tokens: 2000,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 2000 },
}
const USAGE_COST = (1000 * 4 + 500 * 20 + 10_000 * 0.2 + 2000 * 4 * 2) / 1e6 // 0.032
const USAGE_TOKENS = 13_500

const record = (id, timestamp, { model = 'claude-opus-5-5', usage = USAGE } = {}) =>
  JSON.stringify({ timestamp, requestId: `req_${id}`, message: { id: `msg_${id}`, model, usage } })

const writeTranscript = (name, lines, { terminated = true } = {}) =>
  fs.writeFileSync(path.join(projects, name), lines.join('\n') + (terminated ? '\n' : ''))

function run() {
  const r = spawnSync(
    process.execPath,
    [SCRIPT, '--projects', path.join(root, 'projects'), '--out-dir', out, '--now', NOW],
    { env: { ...process.env, TZ }, encoding: 'utf8' },
  )
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.005, `${actual} is not ${expected}`)

describe('aggregate-usage', () => {
  test('prices one response from its token counts', () => {
    writeTranscript('a.jsonl', [record('one', '2026-10-03T01:00:00Z')])
    const s = run()
    near(s.today.usd, USAGE_COST)
    assert.equal(s.today.tokens, USAGE_TOKENS)
  })

  test('counts a response once when its content blocks repeat the usage', () => {
    const line = record('one', '2026-10-03T01:00:00Z')
    writeTranscript('a.jsonl', [line, line, line])
    assert.equal(run().today.tokens, USAGE_TOKENS)
  })

  test('counts a response once when a resumed session copies it into another file', () => {
    const line = record('one', '2026-10-03T01:00:00Z')
    writeTranscript('a.jsonl', [line])
    writeTranscript('b.jsonl', [line, record('two', '2026-10-03T02:00:00Z')])
    assert.equal(run().today.tokens, USAGE_TOKENS * 2)
  })

  test('skips lines without usage, synthetic models and unparseable lines', () => {
    writeTranscript('a.jsonl', [
      JSON.stringify({ type: 'user', message: { content: 'hello' } }),
      record('syn', '2026-10-03T01:00:00Z', { model: '<synthetic>' }),
      '{"usage": "output_tokens" not json',
      record('real', '2026-10-03T01:00:00Z'),
    ])
    assert.equal(run().today.tokens, USAGE_TOKENS)
  })

  test('reads only appended bytes on the next run and waits for a torn last line', () => {
    const file = path.join(projects, 'a.jsonl')
    const second = record('two', '2026-10-03T02:00:00Z')
    fs.writeFileSync(file, record('one', '2026-10-03T01:00:00Z') + '\n' + second.slice(0, 40))
    assert.equal(run().today.tokens, USAGE_TOKENS)

    fs.appendFileSync(file, second.slice(40) + '\n')
    assert.equal(run().today.tokens, USAGE_TOKENS * 2)

    // Nothing appended: the totals must not move.
    assert.equal(run().today.tokens, USAGE_TOKENS * 2)
    const state = JSON.parse(fs.readFileSync(path.join(out, 'usage-state.json'), 'utf8'))
    assert.equal(Object.values(state.files)[0].offset, fs.statSync(file).size)
  })

  test('buckets by local day: 18:00Z on 2 Oct is already 3 Oct in Asia/Saigon', () => {
    writeTranscript('a.jsonl', [
      record('late', '2026-10-02T18:00:00Z'), // 01:00 on 3 Oct local
      record('early', '2026-10-02T16:59:00Z'), // 23:59 on 2 Oct local
    ])
    const s = run()
    assert.equal(s.today.tokens, USAGE_TOKENS)
    assert.equal(s.yesterday.tokens, USAGE_TOKENS)
  })

  test('last30 spans 30 local days; older records are dropped', () => {
    writeTranscript('a.jsonl', [
      record('d29', '2026-09-04T05:00:00Z'), // 29 days before 3 Oct
      record('d30', '2026-09-03T05:00:00Z'), // 30 days before: outside last30
      record('d40', '2026-08-24T05:00:00Z'), // outside the 35-day window entirely
    ])
    const s = run()
    assert.equal(s.last30.tokens, USAGE_TOKENS)
    const state = JSON.parse(fs.readFileSync(path.join(out, 'usage-state.json'), 'utf8'))
    assert.ok(!('2026-08-24' in state.daily))
  })

  test('prices an unknown model with the fallback and reports it', () => {
    writeTranscript('a.jsonl', [record('x', '2026-10-03T01:00:00Z', { model: 'claude-future-9' })])
    const s = run()
    assert.deepEqual(s.unknownModels, ['claude-future-9'])
    assert.ok(s.today.usd > 0)
  })

  test('keeps no prompt text, tool output or path from the transcripts, only counts and times', () => {
    const rec = JSON.parse(record('one', '2026-10-03T01:00:00Z'))
    rec.cwd = '/Users/someone/private-project'
    rec.message.content = [{ type: 'text', text: 'SECRET-PROMPT-TEXT' }]
    writeTranscript('a.jsonl', [JSON.stringify(rec)])
    run()
    for (const name of ['usage.json', 'usage-state.json']) {
      const text = fs.readFileSync(path.join(out, name), 'utf8')
      assert.ok(!text.includes('SECRET-PROMPT-TEXT'), `${name} holds prompt text`)
      assert.ok(!text.includes('private-project'), `${name} holds a project path`)
      assert.ok(!text.includes('a.jsonl'), `${name} holds a transcript file name`)
      assert.ok(!text.includes(projects), `${name} holds the transcripts folder`)
    }
  })

  test('trend lists the last 14 days oldest first, ending today', () => {
    writeTranscript('a.jsonl', [record('one', '2026-10-03T01:00:00Z')])
    const { trend } = run()
    assert.equal(trend.length, 14)
    assert.equal(trend[13].day, '2026-10-03')
    assert.equal(trend[0].day, '2026-09-20')
    near(trend[13].usd, USAGE_COST)
  })
})
