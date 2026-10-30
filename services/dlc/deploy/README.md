# Deploy kit (INTERNAL - do not ship the repository; ship the kit built by build-deploy-kit.ps1)

Windows Server, one host: Keycloak (https) + knowledge store (agents only, 127.0.0.1) + DLC engine + default
frontend, each a Windows service (WinSW). Step-by-step: `docs/internal/deploy/DEPLOY-RUNBOOK.md`.

| File | Runs on | Purpose |
|---|---|---|
| `build-deploy-kit.ps1` | build machine | `-Build` builds the three packages from source (KnowledgeHub `build.ps1`, `packaging/build_dlc.ps1`, `packaging_fe/build_fe.ps1`), then gathers JDK 21, Keycloak 26, WinSW, the packages, the lessons file, a fresh Ed25519 key, these scripts and `SHA256SUMS` into one folder. The kit is a build output: never commit it |
| `windows/stack.config.example.psd1` | VPS | all settings (IP, ports, artifact names, engine profile); copy to `stack.config.psd1` |
| `windows/install-stack.ps1` | VPS (admin) | folders, unpack, Keycloak cert + realm + service, KH `.env` + service, engine and frontend services, firewall |
| `windows/configure-claude-profile.ps1` | VPS (admin) | Claude Code credentials for the engine service (token or profile login) + a non-interactive check |
| `windows/seed-stack.ps1` | VPS (admin) | KH projects + engine namespace/client, engine manifest, lessons, frontend flows, first user |
| `windows/run-install.ps1` | VPS (admin) | one shot: install-stack, configure-claude-profile, seed-stack, verify-stack, logged to `install-log.txt`; `-From 3` resumes |
| `windows/upgrade-stack.ps1` | host (admin) | swap engine and frontend (`-WithKnowledgeStore` also the knowledge store) from a newer kit; keeps data, secrets, token, start and run mode; checks `SHA256SUMS`; backup first |
| `windows/set-claude-token.ps1` | host (admin) | new Claude setup-token from the clipboard for the engine (service or task), checked with `claude -p` |
| `windows/startstop/` | test / dev PC | `grant-startstop.ps1` (admin once: services Manual, user may start/stop, writes `bin`), `make-shortcuts.ps1` (desktop Start DLC / Stop DLC), `Start-DLC.ps1`, `Stop-DLC.ps1` |
| `windows/import-lessons.ps1` | VPS | lessons JSON -> KH project `lesson-learned` (idempotent, read back) |
| `windows/install-graphify.ps1` | host (admin) | Graphify (graphifyy 0.9.73, Apache-2.0) in a venv at `<InstallRoot>\apps\graphify`, checked with a real code-only scan, `LINE_GRAPHIFY` set on the engine (service or task) + restart. Needs Python 3.10+ (`-Python`); offline with `-Wheelhouse`; no stack config: `-InstallRoot C:\DLC`. Linux: `linux/install-graphify.sh --config ...` |
| `windows/verify-stack.ps1` | VPS | PASS/FAIL for every part (engine as service or as the `DLC Engine` task, Chrome for Autologin), exit code = failures |
| `windows/uninstall-stack.ps1` | VPS (admin) | remove services and firewall rules (files kept unless `-RemoveFiles`) |
| `windows/engine-as-user.ps1` | personal PC (admin once) | run the engine as the signed-in user (scheduled task at logon, highest run level, `dlcw.exe`) so agents get that user's git / cf / gh / files; `-Revert` back to the service. Not for a VPS: there the engine service runs as a dedicated account (Log on as) that owns the repositories and holds their credentials, with no UAC or desktop in the way |
| `windows/common.ps1` | - | shared helpers (config, WinSW services) |
| `keycloak/realm-dlc.template.json` | - | realm `dlc`: roles dlc-user / dlc-admin / dlc-viewer; clients dlc-fe, dlc-api, customer-fe, kh-api |
| `keycloak/render-realm.ps1` | VPS | fill IP and ports into the realm import file |
| `keycloak/new-user.ps1` | VPS | create or update a user with roles (admin REST API) |
| `keycloak/test-login.ps1` | anywhere | real authorization-code + PKCE sign-in; checks audience and role |
| `../../KnowledgeHub/deploy/windows/kh.agents.env` | - | KH settings for an agent-only install |

Verified 2026-10-12 on the build machine (no services, same commands): Keycloak 26.0.7 on Java 21 over https
with the generated `keycloak.conf`, realm import, PKCE sign-in -> token `aud dlc-api`, `roles dlc-user`;
KH exe headless with the agent profile (14 capabilities, bound to 127.0.0.1, namespace + client + token,
manifest applied, 367 lessons imported twice -> 367 rows); engine with sign-in on (401 without a token, 200 with
the user token, 401 on a tampered token); frontend package seeding its flows and proxying with the token.
