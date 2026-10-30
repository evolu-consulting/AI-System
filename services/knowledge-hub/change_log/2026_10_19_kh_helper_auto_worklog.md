# 2026-10-19 - the helper writes the work log itself (kh-helper 1.15.0)

| Change | What it does | Where |
|---|---|---|
| Silent Stop | On Claude Code the Stop hook never blocks: it queues the ended turn and returns with no output. Users no longer see `Stop hook error: KH: if this turn changed something...`. Read-only turns and turns that already stored a log queue nothing. | `hooks._run_hook`, `worklog.queue` |
| Detached worker | `kh worklog` slices the turn from the transcript (last prompt on, 12,000 chars, secrets masked), asks the summarizer for `{skip, subject, text}` under the policy's 'store worklog' gate rule, and stores the log with `source: kh-helper auto worklog`. | `worklog.drain` |
| Cheapest model of the CLI's provider | The summarizer is the CLI's own headless mode with its cheapest model, on the person's own sign-in: Claude Code `claude -p --model haiku`, lean (no settings, hooks, MCP, tools, skills or saved session; about 650 tokens of context). No key on the KH server. `KH_HELPER_WORKLOG_CMD` (JSON list, prompt on stdin) sets another command. | `worklog.SUMMARIZERS` |
| Sign-in handover | A detached process has no Claude Code ancestor, so `owner.check` refuses it. The hook, which passed the check, hands its short-lived access token over on the worker's stdin (never disk, env or the refresh token). An expired token leaves the job for the next Stop. | `worklog.spawn`, `worklog.handed_session` |
| Project | The turn's project; the personal project for none, for `orchestrator`, `lesson-learned` and `market`, and on a 403 (with `intended_project`). | `worklog.NO_LOG_PROJECTS`, `worklog.store` |
| No recursion | Inside the summarizer every helper hook exits at once (`KH_HELPER_SUMMARIZER=1`). | `hooks.run_hook` |
| Ctrl+C | Not logged, on purpose: Stop does not fire and the person cancelled that result. | - |
| Other CLIs | Grok has no summarizer yet and keeps the Stop block; Codex and Gemini have no hooks. `KH_HELPER_WORKLOG=off` brings back the 1.13.2 behaviour (PostToolUse nudge + Stop block). | `worklog.enabled` |
| Policy | Action 'store worklog' now fires only when the person asks to log, or an end-of-turn KH check asks (CLIs without the helper's log). Its gate rule stays: the summarizer reads it. | KH policy table |

Users must install 1.15.0 and restart Claude Code; `kh setup` is not needed (no hook changed).

## Helper releases without a KH redeploy (KH artifact store)

| Change | What it does | Where |
|---|---|---|
| Artifact store | A maintainer publishes a file KH hands out with `POST /artifacts {name, content_b64}` or `kh artifact upload <wheel>`; module and version come from the wheel name. `/auth/download/<name>` serves it without sign-in (older versions too, for a rollback); `/auth/config` and `/auth/help` point at the newest kh-helper, from the store or the bundled wheel, whichever is newer. | `app/artifacts.py`, `app/auth.py` |
| Store is a setting | `PUT /artifacts/backend {mode, config}` (maintainers) switches where the bytes live, with no redeploy or restart: `hana` (base64 in `artifact_blob`, the default), `http` (a VPS file server: PUT/GET/DELETE on `base_url`), `s3` (any S3-compatible store: BTP Object Store, AWS, MinIO). The new store is probed, every artifact copied and checked by sha256, then the setting flips; a failing store changes nothing. `serve`: `proxy` (default) or `redirect` (302; presigned for s3). Secrets are masked on read and kept when sent back masked. | `artifact_settings` |
| Update notice | At session start the helper compares its version with `/auth/config` `helper_version` and, when a newer one is published, asks the assistant to run `pip install --upgrade <url>` and to ask for a restart. | kh-helper `hooks.update_note` |
| Dependency | `boto3`/`botocore` 1.43.100, imported only in s3 mode. | `requirements.txt` |

Release from now on: build the wheel, `kh artifact upload dist/kh_helper-<v>-py3-none-any.whl`, overwrite row `ver_kh-helper`. KH needs one deploy to get the store; after that a helper release never redeploys KH.
