'use strict';

const fs = require('fs');
const { Registry } = require('./registry');
const { guardedRead, makeAllowlist } = require('./guard');

function transientError(message) {
  const err = new Error(message);
  err.code = 'ETIMEDOUT';
  err.transient = true;
  return err;
}

function permanentError(message) {
  const err = new Error(message);
  err.code = 'PERMANENT';
  return err;
}

function defaultReadFile(resolvedPath) {
  return fs.promises.readFile(resolvedPath, 'utf8');
}

// options:
//   allowlist: string[] — exact-path allowlist for read_file.
//              null = NO guard (explicit control path, used only to prove the
//              guard is what stops an attack; see scripts/demo-injection.js).
//   files: {[resolvedPath]: string} — in-memory filesystem for tests/demo.
//   readFile: custom async reader (defaults to real fs, or the in-memory map).
// The flaky tool's failure counter is per-registry, i.e. per run.
function createTools(options = {}) {
  const allowlist = options.allowlist === null ? null : makeAllowlist(options.allowlist || []);
  const files = options.files || null;
  const readFile = options.readFile || (files
    ? async (resolvedPath) => {
        if (Object.prototype.hasOwnProperty.call(files, resolvedPath)) return files[resolvedPath];
        const err = new Error(`ENOENT: no such file or directory, open '${resolvedPath}'`);
        err.code = 'ENOENT';
        throw err;
      }
    : defaultReadFile);
  const read = guardedRead(allowlist, readFile);

  const registry = new Registry();
  let flakyCalls = 0;

  registry.register('add', {
    description: 'Add two numbers.',
    args: { a: { type: 'number', required: true }, b: { type: 'number', required: true } },
    handler: async ({ a, b }) => ({ sum: a + b }),
  });

  registry.register('echo', {
    description: 'Echo text back.',
    args: { text: { type: 'string', required: true } },
    handler: async ({ text }) => ({ text }),
  });

  registry.register('read_file', {
    description: 'Read a file. Only exact allowlisted paths are readable.',
    args: { path: { type: 'string', required: true } },
    handler: async ({ path: p }) => ({ path: p, content: await read(p) }),
  });

  registry.register('flaky', {
    description: 'Fails transiently N times, then succeeds. Deterministic.',
    args: { failures: { type: 'integer', required: true } },
    handler: async ({ failures }) => {
      flakyCalls += 1;
      if (flakyCalls <= failures) throw transientError(`flaky: simulated transient failure ${flakyCalls}/${failures}`);
      return { ok: true, calls: flakyCalls };
    },
  });

  registry.register('always_fail', {
    description: 'Always fails with a permanent error.',
    args: { message: { type: 'string', required: false } },
    handler: async ({ message }) => { throw permanentError(message || 'always_fail: permanent failure'); },
  });

  return registry;
}

module.exports = { createTools, transientError, permanentError };
