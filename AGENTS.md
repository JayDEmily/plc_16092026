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
