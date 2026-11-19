# Drill #12 — Agent Harness

A deterministic mini agent loop (Node.js, zero runtime deps) for studying agent
failure modes: tool validation, failure classification and retry, guardrails,
and prompt injection delivered through tool output.

There is no real LLM: the "model" is a deterministic stub scenario, so every
run is reproducible and every claim below can be re-run by hand.

## Design

See DESIGN.md (architecture + threat model, written before the code).

- `src/validate.js` — hand-written typed validator (string, number, integer,
  boolean, array, object; required/optional; unknown keys rejected).
- `src/registry.js` — tool registry; a call is validated before the handler
  runs; unknown tools and malformed args are rejected fail-closed.
- `src/loop.js` — the agent loop. Max-step budget (default 12). Append-only
  JSONL transcript. Stop conditions: final answer, budget exhausted, fatal
  error. Tool output is DATA throughout: the loop never parses a tool result
  for commands.
- `src/failures.js` — classifier + retry. Only a closed list of
  known-transient codes (ETIMEDOUT, ECONNRESET, EAI_AGAIN, EBUSY,
  RATE_LIMITED) or an explicit transient flag is retried. Any other error —
  including an unknown one — is permanent: the loop exits fast with a blocker
  report {reason, tool, code, message, attempts, alternative}. Transient
  retries use backoff (default 50/100/200 ms), max 3 retries.
- `src/guard.js` — file_read guard. Exact-path allowlist (Set of resolved
  absolute paths). No prefix / endsWith / substring matching, no broad
  exceptions. Known limitation: symlinks are not resolved; a production
  guard must realpath both sides.
- `src/tools.js` — built-ins: add, echo, read_file (guarded), flaky (fails
  transiently N times, then succeeds — deterministic), always_fail.
- `scenarios/` — deterministic model stubs (happy, infinite, flaky,
  flaky_exhausted, permanent, injection).

## Threat model (summary)

1. Prompt injection via tool output: a file contains an instruction telling
   the agent to read /etc/passwd. Mitigation: output-is-data plus the
   guardrail allowlist. Residual: exfiltration through an ALLOWED path is
   out of scope — the guard controls paths, not content.
2. Path traversal / prefix confusion: allowlist checked with endsWith or
   startsWith would admit siblings. Mitigation: exact Set match on resolved
   absolute paths.
3. Malformed / unknown tool calls: typed validation, fail-closed, handler
   never runs on invalid args.
4. Infinite loops: maxSteps budget; status budget_exhausted with a full
   transcript.
5. Tool failure: transient (retry) vs permanent (fast exit with blocker
   report + alternative).

## Eval

Deterministic node:test suite (no LLM judge), 18 tests, all passing:

- happy path (add 2 + 3, final answer)
- malformed arg rejected, handler never runs (spy counter stays 0)
- unknown argument key rejected
- unknown tool rejected (UNKNOWN_TOOL, 0 attempts)
- integer type rejects a non-integer
- infinite loop bounded by the budget (12 steps, 12 tool calls)
- maxSteps 0 stops before any tool call
- transient failure retries with backoff, then succeeds (3 attempts, delays 1/2 ms)
- transient failure past max retries stops as transient_exhausted (4 attempts, 3 retries)
- permanent failure exits fast (1 attempt, 0 retries, blocker + alternative)
- classifier is fail-closed (unknown codes and null are permanent)
- injection blocked by the guard (/etc/passwd never read; blocker GUARD_DENIED)
- control: the same payload succeeds without the guard
- allowlist exact-match (sibling prefix paths rejected; exact path allowed)
- no false positive (legitimate allowlisted read completes the run)
- transcript is valid JSONL with ordered seq numbers
- immediate final answer stops at zero steps
- malformed model action stops as a model_error blocker

Run: `npm test` (18/18 pass, ~0.15 s). Demo: `npm run demo`.

## Injection demo (live)

`npm run demo` runs the same injection payload and the same model stub twice:

- Guard ON: status blocked, blocker GUARD_DENIED, attempts 1, alternative
  "Use a path from the allowlist." /etc/passwd read succeeded? false.
- Guard OFF (control): status completed, the read of /etc/passwd succeeds
  (content is SIMULATED — the demo never reads the real file) and the final
  answer carries it. /etc/passwd read succeeded? true.

DEMO RESULT: PASS — the guard is what stops the injection.

## Self-rebuttal attempts (what I tried to break)

- Case-sensitivity slip in the injection stub's trigger check (poison text
  used a capital "Read" while the stub checked lowercase) made the first
  test run complete without attacking — caught by the failing tests, fixed
  with a case-insensitive check, 18/18 green after.
- Transcript kind clobbering: a tool_error/blocker entry's `kind` field was
  overwritten by the error/blocker classification because Transcript.append
  spread data after kind. Caught by reading the demo output, fixed by
  making kind always win (entry type) and renaming the classification to
  `reason` / `errorKind`; tests updated and re-run green.
- Normalization "bypasses": requesting an allowlisted path via `..` or `//`
  resolves to the exact allowlisted path, so it is the same file, not a
  bypass. The genuine residual is symlink escape (documented, out of scope).
