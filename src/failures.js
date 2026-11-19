'use strict';

// Tool-failure classifier + retry. The classifier is fail-closed: only a
// closed list of known-transient codes (or an explicit transient flag) is
// retried. Any other error — including an unknown one — is permanent and the
// loop exits fast instead of retrying blindly.

const TRANSIENT_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'EBUSY', 'RATE_LIMITED']);
const DEFAULT_BACKOFF_MS = [50, 100, 200];
const MAX_RETRIES = 3;

function classify(error) {
  if (!error) return 'permanent';
  if (error.transient === true) return 'transient';
  if (typeof error.code === 'string' && TRANSIENT_CODES.has(error.code)) return 'transient';
  return 'permanent';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Runs fn() with retry on transient errors only.
// Returns { ok: true, value, attempts } or { ok: false, error, attempts, kind }.
// attempts counts executions (1 + retries used). onRetry fires before each
// retry with { attempt, error, delayMs }.
async function callWithRetry(fn, { maxRetries = MAX_RETRIES, backoffMs = DEFAULT_BACKOFF_MS, onRetry } = {}) {
  let attempts = 0;
  for (;;) {
    attempts += 1;
    try {
      const value = await fn();
      return { ok: true, value, attempts };
    } catch (error) {
      const kind = classify(error);
      const retriesUsed = attempts - 1;
      if (kind === 'transient' && retriesUsed < maxRetries) {
        const delayMs = backoffMs[Math.min(retriesUsed, backoffMs.length - 1)];
        if (typeof onRetry === 'function') onRetry({ attempt: attempts, error, delayMs });
        await sleep(delayMs);
        continue;
      }
      return { ok: false, error, attempts, kind };
    }
  }
}

module.exports = { TRANSIENT_CODES, DEFAULT_BACKOFF_MS, MAX_RETRIES, classify, callWithRetry, sleep };
