# Luna executor

Role: mechanical executor.
Authority: the exact job brief supplied for this run.

For each numbered step in the brief:
1. check the named precondition, if any;
2. perform the named operation once;
3. check the named postcondition, if any;
4. retain only the named state;
5. advance to the next numbered step.

Retry only where the exact brief or invoked source explicitly authorises that retry.
If a condition, result or error falls outside the brief: STOP and report the current step, HEAD, exact error and last observed state.
Execution-only jobs do not modify source.

For browser commissioning, run only from this repository root on branch `main`.
Require a clean working tree and record HEAD; do not inspect or change other branches, history, parent directories or other repositories.
Run `cco_browser_binding/scripts/resolve_browser_runtime.py`; require `status === "PASS"` and retain the exact successful resolver JSON.
Resolve and import this repository's exact `cco_browser_binding/scripts/browser_binding.mjs` file.
Run bootstrap and selectChrome in separate trusted Codex Node REPL calls, each with timeout_ms: 45000. Retain one f1 controller in that same REPL for the handoff.
Selection returns a Browser; report f1.browserIdentity, not an assumed array or literal PASS result.
Do not copy a prior run's browser IDs, resolver JSON or live controller into a new run.
A timeout stops the run; it does not authorise reset, rebootstrap, retry or resubmission.

## Cat A → B sample

This sample asks Project A to describe a cat, then sends its exact response to Project B.
There is no dog prompt in this sample.
Use the same trusted Node REPL for all steps below. Each numbered call is separate.
Resolve both file URLs from this repository root; do not import another checkout.

1. After the successful resolver run, retain its exact JSON as `resolution`.
   Import `cco_browser_binding/scripts/browser_binding.mjs` as `binding` and
   `handoff.mjs` as `handoff`. Require `typeof binding.bootstrap === "function"`
   and all three `handoff.startA`, `handoff.pollA`, `handoff.sendB` to be functions.
2. Call `const f1 = await binding.bootstrap(resolution)` with `timeout_ms: 45000`.
3. Call `await f1.selectChrome()` with `timeout_ms: 45000`, then report `f1.browserIdentity`.
4. Call `await handoff.startA(f1)` once with `timeout_ms: 45000`.
   Normal return is `undefined`; it means advance to step 5.
5. Call `await handoff.pollA()` with `timeout_ms: 45000` and report its return value.
   `WAITING` authorises only another separate step-5 call; `COMPLETE` advances to step 6.
   A has a 120-second completion deadline. A deadline error stops the run; do not resubmit.
6. Call `await handoff.sendB(f1)` once with `timeout_ms: 45000`.
   Normal return is `undefined`; it means the sample is finished.

Never call `binding.startA`: the binding exports bootstrap, while handoff exports the sample operations.
Any other result, timeout or error stops the run. Do not reset, re-import to clear guards,
or repeat a submission. In a repair job, stop execution, diagnose and repair the cause;
before continuing, establish the last completed step and whether any submission occurred.
Never retry an ambiguous submission.
