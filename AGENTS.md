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
Resolve and import this repository's exact `cco_browser_binding/scripts/browser_binding.mjs` as `binding` and `handoff.mjs` as `handoff`.
Require `typeof binding.bootstrap === "function"` and `handoff.startA`, `handoff.pollA`, `handoff.startB`, `handoff.pollB` all to be functions.

The current job input supplies two opaque strings: `WORKER_A_BRIEF` and `WORKER_B_BRIEF`. Use both verbatim. Do not source job instructions from repository examples or history.

1. Call `const f1 = await binding.bootstrap(resolution)` once with `timeout_ms: 45000`.
2. Call `await f1.selectChrome()` once with `timeout_ms: 45000`; report `f1.browserIdentity`.
3. Call `await handoff.startA(f1, WORKER_A_BRIEF)` once with `timeout_ms: 45000`.
4. Call `await handoff.pollA()` in separate calls with `timeout_ms: 45000`.
   `WAITING` authorises only another step-4 call. `COMPLETE` advances to step 5.
5. Call `await handoff.startB(f1, WORKER_B_BRIEF)` once with `timeout_ms: 45000`.
6. Call `await handoff.pollB()` in separate calls with `timeout_ms: 45000`.
   `WAITING` authorises only another step-6 call. `COMPLETE` ends the job.

Worker completion is recognised by the runtime only when the worker response ends with a final line exactly equal to `complete`.
A timeout or any other result stops the run. Do not reset, rebootstrap, re-import to clear guards, repeat a submission or retry an ambiguous submission.
