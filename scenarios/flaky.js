'use strict';

// Transient failure, then success: flaky fails twice, succeeds on attempt 3.

function next(entries) {
  const results = entries.filter((e) => e.kind === 'tool_result');
  if (results.length === 0) return { type: 'tool', name: 'flaky', args: { failures: 2 } };
  return { type: 'final', answer: 'flaky tool eventually succeeded' };
}

module.exports = { name: 'flaky', allowlist: [], files: {}, next };
