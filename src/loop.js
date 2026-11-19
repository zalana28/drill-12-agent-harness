'use strict';

const { validateArgs } = require('./validate');
const { callWithRetry } = require('./failures');
const { Transcript } = require('./transcript');

function alternativeFor(error) {
  switch (error && error.code) {
    case 'VALIDATION': return 'Fix the arguments to match the tool schema, then retry.';
    case 'UNKNOWN_TOOL': return 'Use a registered tool name.';
    case 'GUARD_DENIED': return 'Use a path from the allowlist.';
    case 'ENOENT': return 'Check that the path exists.';
    default: return 'Verify inputs and retry manually.';
  }
}

// One tool call, end to end. Unknown tools and validation failures are
// rejected with attempts: 0 — the handler never runs. Validated calls go
// through the retry policy (transient only, max 3 retries).
async function executeCall(registry, name, args, { backoffMs, onRetry } = {}) {
  const tool = registry.get(name);
  if (!tool) {
    const error = new Error(`unknown tool: ${name}`);
    error.code = 'UNKNOWN_TOOL';
    return { ok: false, error, attempts: 0, kind: 'permanent' };
  }
  let valid;
  try {
    valid = validateArgs(tool.args, args);
  } catch (error) {
    return { ok: false, error, attempts: 0, kind: 'permanent' };
  }
  return callWithRetry(() => tool.handler(valid), { backoffMs, onRetry });
}

// The agent loop. Stop conditions, in order:
//   - final answer  -> { status: 'completed' }
//   - step budget   -> { status: 'budget_exhausted' }
//   - fatal error   -> { status: 'blocked', blocker }
// A blocker is { reason, tool, code, message, attempts, alternative } where
// reason is 'permanent', 'transient_exhausted', 'budget_exhausted' or
// 'model_error'. Tool output is treated as DATA throughout: the loop never
// parses a tool result for commands.
async function runLoop({ registry, model, maxSteps = 12, backoffMs, transcriptFile } = {}) {
  if (!registry) throw new Error('runLoop: registry is required');
  if (!model || typeof model.next !== 'function') throw new Error('runLoop: model.next is required');
  const transcript = new Transcript();
  let steps = 0;

  for (;;) {
    let action;
    try {
      action = model.next(transcript.entries);
    } catch (error) {
      const blocker = { reason: 'model_error', tool: null, code: (error && error.code) || 'MODEL_ERROR', message: String((error && error.message) || error), attempts: 0, alternative: 'Fix the model stub to emit a tool call or a final answer.' };
      transcript.append('blocker', blocker);
      const result = { status: 'blocked', blocker, steps, transcript };
      if (transcriptFile) await transcript.save(transcriptFile);
      return result;
    }
    transcript.append('model', { action });

    if (action && action.type === 'final') {
      transcript.append('final', { answer: action.answer });
      const result = { status: 'completed', finalAnswer: action.answer, steps, transcript };
      if (transcriptFile) await transcript.save(transcriptFile);
      return result;
    }
    if (!action || action.type !== 'tool' || typeof action.name !== 'string') {
      const blocker = { reason: 'model_error', tool: null, code: 'MODEL_ERROR', message: `malformed model action: ${JSON.stringify(action)}`, attempts: 0, alternative: 'Fix the model stub to emit a tool call or a final answer.' };
      transcript.append('blocker', blocker);
      const result = { status: 'blocked', blocker, steps, transcript };
      if (transcriptFile) await transcript.save(transcriptFile);
      return result;
    }
    if (steps >= maxSteps) {
      const blocker = { reason: 'budget_exhausted', tool: null, code: 'BUDGET_EXHAUSTED', message: `step budget exhausted after ${maxSteps} tool calls`, attempts: 0, alternative: 'Raise maxSteps or make the model emit a final answer sooner.' };
      transcript.append('blocker', blocker);
      const result = { status: 'budget_exhausted', blocker, steps, transcript };
      if (transcriptFile) await transcript.save(transcriptFile);
      return result;
    }

    steps += 1;
    transcript.append('tool_call', { step: steps, name: action.name, args: action.args });
    const outcome = await executeCall(registry, action.name, action.args, {
      backoffMs,
      onRetry: ({ attempt, error, delayMs }) => transcript.append('retry', { step: steps, name: action.name, attempt, error: error.message, code: error.code, delayMs }),
    });

    if (outcome.ok) {
      transcript.append('tool_result', { step: steps, name: action.name, result: outcome.value, attempts: outcome.attempts });
    } else {
      transcript.append('tool_error', { step: steps, name: action.name, error: outcome.error.message, code: outcome.error.code || 'ERROR', errorKind: outcome.kind, attempts: outcome.attempts });
      const blocker = {
        reason: outcome.kind === 'transient' ? 'transient_exhausted' : 'permanent',
        tool: action.name,
        code: outcome.error.code || 'ERROR',
        message: outcome.error.message,
        attempts: outcome.attempts,
        alternative: alternativeFor(outcome.error),
      };
      transcript.append('blocker', blocker);
      const result = { status: 'blocked', blocker, steps, transcript };
      if (transcriptFile) await transcript.save(transcriptFile);
      return result;
    }
  }
}

module.exports = { runLoop, executeCall, alternativeFor };
