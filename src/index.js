'use strict';

const { createTools } = require('./tools');
const { runLoop } = require('./loop');

const SCENARIOS = {
  happy: () => require('../scenarios/happy'),
  infinite: () => require('../scenarios/infinite'),
  flaky: () => require('../scenarios/flaky'),
  flaky_exhausted: () => require('../scenarios/flaky-exhausted'),
  permanent: () => require('../scenarios/permanent'),
  injection: () => require('../scenarios/injection'),
};

async function runScenario(scenario, options = {}) {
  const registry = createTools({
    allowlist: options.allowlist !== undefined ? options.allowlist : scenario.allowlist,
    files: options.files !== undefined ? options.files : scenario.files,
    readFile: options.readFile,
  });
  return runLoop({
    registry,
    model: scenario,
    maxSteps: options.maxSteps,
    backoffMs: options.backoffMs,
    transcriptFile: options.transcriptFile,
  });
}

async function main(argv = process.argv.slice(2)) {
  const name = argv[0] || 'happy';
  const load = SCENARIOS[name];
  if (!load) {
    console.error(`unknown scenario: ${name} (available: ${Object.keys(SCENARIOS).join(', ')})`);
    process.exitCode = 2;
    return;
  }
  const scenario = load();
  const guardIdx = argv.indexOf('--guard');
  const guardOff = guardIdx >= 0 && argv[guardIdx + 1] === 'off';
  const maxStepsIdx = argv.indexOf('--max-steps');
  const maxSteps = maxStepsIdx >= 0 ? Number(argv[maxStepsIdx + 1]) : undefined;
  const result = await runScenario(scenario, {
    allowlist: guardOff ? null : (scenario.allowlist || []),
    files: scenario.files || {},
    maxSteps,
  });
  console.log(JSON.stringify({ scenario: name, status: result.status, steps: result.steps, finalAnswer: result.finalAnswer || null, blocker: result.blocker || null }, null, 2));
  console.log('--- transcript (JSONL) ---');
  console.log(result.transcript.toJSONL());
}

if (require.main === module) main();

module.exports = { runScenario, SCENARIOS };
