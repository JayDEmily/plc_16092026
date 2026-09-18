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
Resolve and import this repository's exact `cco_browser_binding/scripts/browser_binding.mjs` as `binding` and `cco_browser_binding/scripts/handoff.mjs` as `handoff` in that REPL.
Require `typeof binding.bootstrap === "function"` and `handoff.startA`, `handoff.pollA`, `handoff.startB`, `handoff.pollB`, `handoff.continueA`, `handoff.continueB` all to be functions.

The current job input supplies two opaque strings: `WORKER_A_BRIEF` and `WORKER_B_BRIEF`. Use both verbatim. Do not source job instructions from repository examples or history.

1. Call `const f1 = await binding.bootstrap(resolution)` once with `timeout_ms: 45000`.
2. Call `await f1.selectChrome()` once with `timeout_ms: 45000`; report `f1.browserIdentity`.
3. Call `await handoff.startA(f1, WORKER_A_BRIEF)` once with `timeout_ms: 45000`.
4. Call `await handoff.pollA()` in separate calls with `timeout_ms: 45000` for the initial Worker A phase.
   - `WAITING` authorises only another step-4 call.
   - `unfinished` advances to step 5.
   - `complete` retains the entire Worker A response from the turn that returned `complete` and advances to step 6.
   - `accomplished` ends the job successfully.
   - `error` stops the run and reports the entire Worker A response.
   - `check latest work in Google Drive` is invalid before Worker B exists and stops the run.
5. Call `await handoff.continueA()` once with `timeout_ms: 45000`. This sends exactly `Continue working.` to the retained Project A conversation. Return to step 4.
6. Call `await handoff.startB(f1, WORKER_B_BRIEF)` once with `timeout_ms: 45000`. The handoff module appends the retained Worker A response that returned `complete` to the original Worker B brief. Do not create Worker B again.
7. Call `await handoff.pollB()` in separate calls with `timeout_ms: 45000`.
   - `WAITING` authorises only another step-7 call.
   - `unfinished` advances to step 8.
   - `check latest work in Google Drive` advances to step 9.
   - `accomplished` ends the job successfully.
   - `error` stops the run and reports the entire Worker B response.
   - `complete` is invalid after Worker B exists and stops the run.
8. Call `await handoff.continueB()` once with `timeout_ms: 45000`. This sends exactly `Continue working.` to the retained Project B conversation. Return to step 7.
9. Call `await handoff.continueA()` once with `timeout_ms: 45000`. This sends exactly `Check latest work in Google Drive.` to the retained Project A conversation. Advance to step 10.
10. Call `await handoff.pollA()` in separate calls with `timeout_ms: 45000` for the iterative phase.
    - `WAITING` authorises only another step-10 call.
    - `unfinished` advances to step 11.
    - `check latest work in Google Drive` advances to step 12.
    - `accomplished` ends the job successfully.
    - `error` stops the run and reports the entire Worker A response.
    - `complete` is invalid after Worker B exists and stops the run.
11. Call `await handoff.continueA()` once with `timeout_ms: 45000`. This sends exactly `Continue working.` to the retained Project A conversation. Return to step 10.
12. Call `await handoff.continueB()` once with `timeout_ms: 45000`. This sends exactly `Check latest work in Google Drive.` to the retained Project B conversation. Return to step 7.

Inspect only the last non-empty line of a worker response, case-insensitively. Use the permissive ordered recogniser in `handoff.mjs`: `error`, then `unfinished`, then `complete`, then `check latest work in Google Drive`, then `accomplished`. No whole-line match, exact spacing, exact punctuation or absence of surrounding prose is required. If no recognised outcome appears, `WAITING` remains the private internal polling condition and is never a worker-facing outcome.

The fixed continuation prompts have distinct meanings:
- same retained worker after `unfinished`: exactly `Continue working.`
- opposite retained worker after `check latest work in Google Drive`: exactly `Check latest work in Google Drive.`

Do not recreate either Project, rebootstrap the browser, or resend either original brief during iteration. Drive, Git, handoff-file, tarball and substantive task semantics belong only to the worker briefs and repositories, not Luna.
Do not call `startBFromCompletedA(...)` during the normal launch path. It remains a bounded recovery helper only; because it has no retained Worker A conversation, a later B-to-A Drive baton stops rather than reconstructing A.
A timeout or any other result outside this contract stops the run. Do not reset, rebootstrap, re-import to clear guards, repeat a submission or retry an ambiguous submission.
