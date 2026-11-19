'use strict';

const path = require('path');

// file_read guard: exact-path allowlist, fail-closed.
// A read is allowed only if path.resolve(requested) is EXACTLY in the set.
// No prefix / endsWith / substring matching, no broad exceptions.
// Known limitation: symlinks are not resolved (no realpath); a production
// guard must realpath both sides before comparing.

class GuardError extends Error {
  constructor(requested) {
    super(`read denied: path is not in the allowlist: ${requested}`);
    this.name = 'GuardError';
    this.code = 'GUARD_DENIED';
    this.path = requested;
  }
}

function makeAllowlist(paths) {
  if (!Array.isArray(paths)) throw new Error('allowlist must be an array of paths');
  return new Set(paths.map((p) => path.resolve(p)));
}

function isAllowed(allowlist, requested) {
  return allowlist.has(path.resolve(requested));
}

// Returns an async read function enforcing the allowlist exactly.
// allowlist === null means "no guard" — the explicit control path used only
// to prove the guard is what stops an attack (scripts/demo-injection.js).
function guardedRead(allowlist, readFile) {
  return async (requested) => {
    if (allowlist !== null) {
      if (!isAllowed(allowlist, requested)) throw new GuardError(requested);
    }
    return readFile(path.resolve(requested));
  };
}

module.exports = { GuardError, makeAllowlist, isAllowed, guardedRead };
