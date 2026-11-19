'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { Registry } = require('../src/registry');
const { validateArgs, ValidationError } = require('../src/validate');
const { classify } = require('../src/failures');
const { makeAllowlist, isAllowed, GuardError } = require('../src/guard');
const { Transcript } = require('../src/transcript');
const { createTools } = require('../src/tools');
const { runLoop } = require('../src/loop');
const { runScenario } = require('../src/index');
const happy = require('../scenarios/happy');
const infinite = require('../scenarios/infinite');
const flaky = require('../scenarios/flaky');
const flakyExhausted = require('../scenarios/flaky-exhausted');
const permanent = require('../scenarios/permanent');
const injection = require('../scenarios/injection');

const FAST_BACKOFF = [1, 2, 4];

function memFiles(map) {
  const out = {};
  for (const [k, v] of Object.entries(map)) out[path.resolve(k)] = v;
  return out;
}

describe('agent harness', () => {
  it('happy path: add 2 + 3, then a final answer', async () => {
    const r = await runScenario(happy, { backoffMs: FAST_BACKOFF });
    assert.equal(r.status, 'completed');
    assert.equal(r.finalAnswer, '2 + 3 = 5');
    assert.equal(r.steps, 1);
  });

  it('malformed arg is rejected and the handler never runs', async () => {
    let runs = 0;
    const registry = new Registry();
    registry.register('spy', {
      description: 'spy',
      args: { n: { type: 'number', required: true } },
      handler: async () => { runs += 1; return {}; },
    });
    const model = {
      next: (entries) => (entries.some((e) => e.kind === 'tool_call')
        ? { type: 'final', answer: 'done' }
        : { type: 'tool', name: 'spy', args: { n: 'not-a-number' } }),
    };
    const r = await runLoop({ registry, model, backoffMs: FAST_BACKOFF });
    assert.equal(r.status, 'blocked');
    assert.equal(r.blocker.code, 'VALIDATION');
    assert.equal(runs, 0);
  });

  it('unknown argument key is rejected', () => {
    assert.throws(
      () => validateArgs({ a: { type: 'number', required: true } }, { a: 1, c: 3 }),
      (e) => e instanceof ValidationError && /unknown argument/.test(e.message),
    );
  });

  it('unknown tool is rejected with UNKNOWN_TOOL and zero attempts', async () => {
    const registry = createTools({});
    const model = { next: () => ({ type: 'tool', name: 'nope', args: {} }) };
    const r = await runLoop({ registry, model, backoffMs: FAST_BACKOFF });
    assert.equal(r.status, 'blocked');
    assert.equal(r.blocker.code, 'UNKNOWN_TOOL');
    assert.equal(r.blocker.attempts, 0);
  });

  it('integer type rejects a non-integer and accepts an integer', () => {
    assert.throws(
      () => validateArgs({ failures: { type: 'integer', required: true } }, { failures: 1.5 }),
      ValidationError,
    );
    assert.equal(validateArgs({ failures: { type: 'integer', required: true } }, { failures: 2 }).failures, 2);
  });

  it('infinite loop is bounded by the step budget', async () => {
    const r = await runScenario(infinite, { maxSteps: 12, backoffMs: FAST_BACKOFF });
    assert.equal(r.status, 'budget_exhausted');
    assert.equal(r.steps, 12);
    assert.equal(r.transcript.entries.filter((e) => e.kind === 'tool_call').length, 12);
  });

  it('maxSteps 0 stops before any tool call', async () => {
    const r = await runScenario(infinite, { maxSteps: 0, backoffMs: FAST_BACKOFF });
    assert.equal(r.status, 'budget_exhausted');
    assert.equal(r.steps, 0);
    assert.equal(r.transcript.entries.filter((e) => e.kind === 'tool_call').length, 0);
  });

  it('transient failure retries with backoff, then succeeds', async () => {
    const r = await runScenario(flaky, { backoffMs: FAST_BACKOFF });
    assert.equal(r.status, 'completed');
    const result = r.transcript.entries.find((e) => e.kind === 'tool_result');
    assert.equal(result.attempts, 3);
    const retries = r.transcript.entries.filter((e) => e.kind === 'retry');
    assert.equal(retries.length, 2);
    assert.deepEqual(retries.map((x) => x.delayMs), [1, 2]);
  });

  it('transient failure past max retries stops as transient_exhausted', async () => {
    const r = await runScenario(flakyExhausted, { backoffMs: FAST_BACKOFF });
    assert.equal(r.status, 'blocked');
    assert.equal(r.blocker.reason, 'transient_exhausted');
    assert.equal(r.blocker.attempts, 4);
    assert.equal(r.transcript.entries.filter((e) => e.kind === 'retry').length, 3);
  });

  it('permanent failure exits fast with a blocker report and an alternative', async () => {
    const r = await runScenario(permanent, { backoffMs: FAST_BACKOFF });
    assert.equal(r.status, 'blocked');
    assert.equal(r.blocker.reason, 'permanent');
    assert.equal(r.blocker.attempts, 1);
    assert.equal(r.transcript.entries.filter((e) => e.kind === 'retry').length, 0);
    assert.equal(typeof r.blocker.alternative, 'string');
    assert.ok(r.blocker.alternative.length > 0);
  });

  it('classifier is fail-closed: only known-transient codes retry', () => {
    assert.equal(classify({ code: 'ETIMEDOUT' }), 'transient');
    assert.equal(classify({ transient: true }), 'transient');
    assert.equal(classify({ code: 'ENOENT' }), 'permanent');
    assert.equal(classify({ code: 'SOME_UNKNOWN_CODE' }), 'permanent');
    assert.equal(classify({}), 'permanent');
    assert.equal(classify(null), 'permanent');
  });

  it('injection is blocked by the guard: /etc/passwd is never read', async () => {
    const r = await runScenario(injection, { allowlist: injection.allowlist, files: injection.files, backoffMs: FAST_BACKOFF });
    assert.equal(r.status, 'blocked');
    assert.equal(r.blocker.code, 'GUARD_DENIED');
    assert.equal(
      r.transcript.entries.filter((e) => e.kind === 'tool_result' && e.name === 'read_file' && e.result.path === '/etc/passwd').length,
      0,
    );
    assert.ok(r.blocker.alternative.length > 0);
    const denied = r.transcript.entries.find((e) => e.kind === 'tool_error' && e.code === 'GUARD_DENIED');
    assert.ok(denied, 'expected a tool_error entry with code GUARD_DENIED');
    assert.equal(denied.errorKind, 'permanent');
  });

  it('control: the same payload succeeds without the guard', async () => {
    const r = await runScenario(injection, { allowlist: null, files: injection.files, backoffMs: FAST_BACKOFF });
    assert.equal(r.status, 'completed');
    const leaked = r.transcript.entries.find((e) => e.kind === 'tool_result' && e.name === 'read_file' && e.result.path === '/etc/passwd');
    assert.ok(leaked, 'expected a successful read of /etc/passwd in the control run');
    assert.match(r.finalAnswer, /SIMULATED/);
  });

  it('allowlist is exact-match: sibling prefix paths are rejected', async () => {
    const list = makeAllowlist(['/data/notes.txt']);
    assert.equal(isAllowed(list, '/data/notes.txt'), true);
    assert.equal(isAllowed(list, '/data/notes.txt.bak'), false);
    assert.equal(isAllowed(list, '/data/notes2.txt'), false);
    const registry = createTools({
      allowlist: ['/data/notes.txt'],
      files: memFiles({ '/data/notes.txt': 'ok', '/data/notes.txt.bak': 'bak', '/data/notes2.txt': 'two' }),
    });
    const ok = await registry.get('read_file').handler({ path: '/data/notes.txt' });
    assert.equal(ok.content, 'ok');
    for (const p of ['/data/notes.txt.bak', '/data/notes2.txt', '/data/notes.txt/child', '/data/NOTES.txt']) {
      await assert.rejects(
        registry.get('read_file').handler({ path: p }),
        (e) => e instanceof GuardError && e.code === 'GUARD_DENIED',
      );
    }
  });

  it('no false positive: a legitimate allowlisted read completes the run', async () => {
    const files = memFiles({ '/data/notes.txt': 'hello world' });
    const scenario = {
      allowlist: ['/data/notes.txt'],
      files,
      next(entries) {
        const done = entries.some((e) => e.kind === 'tool_result');
        if (!done) return { type: 'tool', name: 'read_file', args: { path: '/data/notes.txt' } };
        const content = entries.find((e) => e.kind === 'tool_result').result.content;
        return { type: 'final', answer: `read: ${content}` };
      },
    };
    const r = await runScenario(scenario, { backoffMs: FAST_BACKOFF });
    assert.equal(r.status, 'completed');
    assert.equal(r.finalAnswer, 'read: hello world');
  });

  it('transcript is valid JSONL with ordered seq numbers', async () => {
    const r = await runScenario(happy, { backoffMs: FAST_BACKOFF });
    const lines = Transcript.parse(r.transcript.toJSONL());
    assert.ok(lines.length > 0);
    lines.forEach((entry, i) => assert.equal(entry.seq, i + 1));
    assert.ok(lines.some((e) => e.kind === 'model'));
    assert.ok(lines.some((e) => e.kind === 'tool_call'));
    assert.ok(lines.some((e) => e.kind === 'tool_result'));
    assert.ok(lines.some((e) => e.kind === 'final'));
  });

  it('immediate final answer stops at zero steps', async () => {
    const registry = createTools({});
    const model = { next: () => ({ type: 'final', answer: 'done immediately' }) };
    const r = await runLoop({ registry, model, backoffMs: FAST_BACKOFF });
    assert.equal(r.status, 'completed');
    assert.equal(r.steps, 0);
    assert.equal(r.finalAnswer, 'done immediately');
  });

  it('malformed model action stops as a model_error blocker', async () => {
    const registry = createTools({});
    const model = { next: () => ({ type: 'teleport', where: 'nowhere' }) };
    const r = await runLoop({ registry, model, backoffMs: FAST_BACKOFF });
    assert.equal(r.status, 'blocked');
    assert.equal(r.blocker.reason, 'model_error');
  });
});
