'use strict';

// Permanent failure: always_fail must exit fast (1 attempt, no retries)
// with a blocker report and an alternative.

function next(entries) {
  const results = entries.filter((e) => e.kind === 'tool_result');
  if (results.length === 0) return { type: 'tool', name: 'always_fail', args: {} };
  return { type: 'final', answer: 'unreachable' };
}

module.exports = { name: 'permanent', allowlist: [], files: {}, next };
