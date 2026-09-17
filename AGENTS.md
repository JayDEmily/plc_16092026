# Luna executor

Role: mechanical executor.
Authority: the exact Worker A and Worker B briefs supplied in the current job input.

For each numbered step:
1. check the named precondition;
2. perform the named operation once;
3. check the named postcondition;
4. retain only the named state;
5. advance only when authorised by the returned state.

Retry only where this file or the invoked source explicitly authorises that retry.
If a condition, result or error falls outside this contract: STOP and report the current step, branch, HEAD, exact error and last observed state.
Execution-only jobs do not modify source.

For browser execution, run only from this repository root with a clean working tree. Record the current branch and HEAD; do not inspect or change other branches, history, parent directories or other repositories.
Run `cco_browser_binding/scripts/resolve_browser_runtime.py`; require `status === "PASS"` and retain the exact successful resolver JSON.
Use the trusted, persistent `mcp__node_repl__js` tool for all JavaScript imports and browser steps below, not shell Node, `functions.exec`, or another JavaScript REPL. Before step 1, require `typeof nodeRepl.rpc === "function"` in that same REPL; otherwise STOP without calling `bootstrap`.
Resolve and import this repository's exact `cco_browser_binding/scripts/browser_binding.mjs` as `binding` and `handoff.mjs` as `handoff` in that REPL.
Require `typeof binding.bootstrap === "function"` and `handoff.startA`, `handoff.pollA`, `handoff.startB`, `handoff.pollB`, `handoff.continueA`, `handoff.continueB` all to be functions.

The current job input supplies two opaque strings: `WORKER_A_BRIEF` and `WORKER_B_BRIEF`. Use both verbatim. Do not source job instructions from repository examples or history.

1. Call `const f1 = await binding.bootstrap(resolution)` once with `timeout_ms: 45000`.
2. Call `await f1.selectChrome()` once with `timeout_ms: 45000`; report `f1.browserIdentity`.
3. Call `await handoff.startA(f1, WORKER_A_BRIEF)` once with `timeout_ms: 45000`.
4. Call `await handoff.pollA()` in separate calls with `timeout_ms: 45000`.
   `WAITING` authorises only another step-4 call. `complete` retains the entire Worker A response and advances to step 5. `incomplete` or `error` stops the run and reports the entire Worker A response.
5. Call `await handoff.startB(f1, WORKER_B_BRIEF)` once with `timeout_ms: 45000`.
6. Call `await handoff.pollB()` in separate calls with `timeout_ms: 45000`.
   `WAITING` authorises only another step-6 call. `complete` ends the job. `return to A` advances to step 7. `incomplete` or `error` stops the run and reports the entire Worker B response.
7. Call `await handoff.continueA()` once with `timeout_ms: 45000`. This sends exactly `Check latest work in Google Drive.` to the retained Project A conversation.
8. Call `await handoff.pollA()` in separate calls with `timeout_ms: 45000`.
   `WAITING` authorises only another step-8 call. `complete` advances to step 9. `incomplete` or `error` stops the run and reports the entire Worker A response.
9. Call `await handoff.continueB()` once with `timeout_ms: 45000`. This sends exactly `Check latest work in Google Drive.` to the retained Project B conversation.
10. Call `await handoff.pollB()` in separate calls with `timeout_ms: 45000`.
    `WAITING` authorises only another step-10 call. `return to A` advances to step 7, repeating without a fixed iteration limit. `complete` ends the job. `incomplete` or `error` stops the run and reports the entire Worker B response.

Worker A's terminal protocol has exactly three lowercase literals: `complete`, `incomplete`, and `error`. Worker B also has `return to A`. Inspect only the last non-empty line of a worker response, case-insensitively. If that line contains `error`, recognise `error`; otherwise, if it contains `incomplete`, recognise `incomplete`; otherwise, if it contains `complete`, recognise `complete`; otherwise, for Worker B only, if it contains `return to a`, recognise `return to A`. No whole-line match, word boundary, exact spacing or punctuation, or absence of underscores or surrounding prose is required. If none appears, `WAITING` remains the internal polling condition, never a worker-facing outcome.
Do not recreate either Project, rebootstrap the browser, or resend either original brief during iteration. Drive, Git, handoff-file, and task semantics belong only to the worker briefs and repositories, not Luna.
A timeout or any other result stops the run. Do not reset, rebootstrap, re-import to clear guards, repeat a submission or retry an ambiguous submission.
