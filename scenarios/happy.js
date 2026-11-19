'use strict';

// Happy path: add 2 + 3, then answer with the sum.

function next(entries) {
  const results = entries.filter((e) => e.kind === 'tool_result');
  if (results.length === 0) return { type: 'tool', name: 'add', args: { a: 2, b: 3 } };
  const sum = results[results.length - 1].result.sum;
  return { type: 'final', answer: `2 + 3 = ${sum}` };
}

module.exports = { name: 'happy', allowlist: [], files: {}, next };
