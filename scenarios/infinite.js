'use strict';

// Never emits a final answer: the loop budget must stop it.

function next() {
  return { type: 'tool', name: 'echo', args: { text: 'again' } };
}

module.exports = { name: 'infinite', allowlist: [], files: {}, next };
