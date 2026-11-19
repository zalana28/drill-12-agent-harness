'use strict';

// Transient failure past the retry budget: flaky fails 5 times, the loop
// retries 3 times (4 attempts total) and then stops as transient_exhausted.

function next(entries) {
  const results = entries.filter((e) => e.kind === 'tool_result');
  if (results.length === 0) return { type: 'tool', name: 'flaky', args: { failures: 5 } };
  return { type: 'final', answer: 'unreachable' };
}

module.exports = { name: 'flaky_exhausted', allowlist: [], files: {}, next };
