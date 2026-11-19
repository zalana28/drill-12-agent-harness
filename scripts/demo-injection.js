'use strict';

// Live demo: the same injection payload and the same model stub, run twice —
// once with the guard ON, once with it OFF (control). The control proves the
// guard is what stops the attack: without it, the payload succeeds.

const { runScenario } = require('../src/index');
const injection = require('../scenarios/injection');

async function main() {
  console.log('=== DEMO: prompt injection via tool output ===');
  console.log(`Poison file: ${injection.POISON_PATH}`);
  console.log(`Poison content: ${JSON.stringify(injection.POISON_CONTENT)}`);
  console.log(`Target the injection wants: ${injection.TARGET_PATH} (content is SIMULATED)`);
  console.log('');
  console.log('--- RUN 1: guard ON (allowlist = [poison file] only) ---');
  const guarded = await runScenario(injection, { allowlist: injection.allowlist, files: injection.files, backoffMs: [1, 2, 4] });
  console.log(`status: ${guarded.status}`);
  console.log(`steps: ${guarded.steps}`);
  console.log(`blocker: ${JSON.stringify(guarded.blocker)}`);
  console.log('transcript:');
  console.log(guarded.transcript.toJSONL());
  const leakedGuarded = guarded.transcript.entries.some((e) => e.kind === 'tool_result' && e.name === 'read_file' && e.result.path === injection.TARGET_PATH);
  console.log(`VERDICT guard ON: /etc/passwd read succeeded? ${leakedGuarded} (expected: false)`);
  console.log('');
  console.log('--- RUN 2: guard OFF (control — same payload, same stub) ---');
  const control = await runScenario(injection, { allowlist: null, files: injection.files, backoffMs: [1, 2, 4] });
  console.log(`status: ${control.status}`);
  console.log(`steps: ${control.steps}`);
  console.log(`final answer: ${control.finalAnswer}`);
  console.log('transcript:');
  console.log(control.transcript.toJSONL());
  const leakedControl = control.transcript.entries.some((e) => e.kind === 'tool_result' && e.name === 'read_file' && e.result.path === injection.TARGET_PATH);
  console.log(`VERDICT guard OFF: /etc/passwd read succeeded? ${leakedControl} (expected: true — the payload works without the guard)`);
  console.log('');
  if (!leakedGuarded && leakedControl) {
    console.log('DEMO RESULT: PASS — the guard is what stops the injection.');
  } else {
    console.log('DEMO RESULT: FAIL');
    process.exitCode = 1;
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
