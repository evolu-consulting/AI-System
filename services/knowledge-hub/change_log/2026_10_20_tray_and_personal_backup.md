# 2026-10-20 - status tray for a local KH; personal projects in a sync backup

## Tray icon only where there is a desktop

| Change | What it does | Where |
|---|---|---|
| Detection | `tray_supported()` decides from the process itself: no tray with `KH_NO_TRAY=1`, on a cloud host (`VCAP_APPLICATION`, `CF_INSTANCE_GUID`, `KUBERNETES_SERVICE_HOST`), off Windows, in session 0 (a service or a SYSTEM task), without a visible window station, or when pystray cannot load. The server's own tray uses it and runs headless otherwise; a tray that still fails at run time leaves the server running. | `app/desktop.py`, `main.run_tray` |
| Status tray | `KnowledgeHub.exe --tray [--port N]` runs in the person's session next to a KH that runs as a service. It starts no server and opens no store: it asks `/health` every 5 s and shows a dot (green ready, amber starting, red stopped), with a notice on each change. Menu: Home, Swagger, Health, log folder, start the 'KH Server' task when stopped, exit. One per port and session. It never stops a KH process. Log: `%LOCALAPPDATA%\KnowledgeHub\status-tray.log`. | `app/status_tray.py`, `main.py` (branches off before the server modules load) |
| Installer | Services mode registers `HKLM\...\Run` 'KnowledgeHub Tray' = `KnowledgeHub.exe --tray --port <kh-port>` and starts it; uninstall removes it. `kh\.env` no longer carries `KH_NO_TRAY=1` (the detection covers session 0), so a `--no-services` install shows the server's own tray. | KH_Setup `setup/install.py`, `setup/uninstall.py` |
| Preflight | A starting server no longer kills the status tray as a 'stale KnowledgeHub' (same exe, `--tray` in its command line). Found on the E: machine: `schtasks /Run 'KH Server'` killed the tray. | `preflight._is_kh_instance` |
| Installer source | The KH_Setup installer (install-kh.cmd, INSTALL.html, setup/*.py, start scripts, kh-helper setup, seed) now lives in `deploy/windows/kh-setup/`; `build_kh_setup.py` assembles a package from it, a clean KH build, the kh-helper wheel and the runtimes of an earlier package (`--refresh-seed` reads the Prod kernel first). Also fixed there: in services mode `initdb` could not read the password file (restricted token without Administrators); the running user may read it while initdb runs. | `deploy/windows/kh-setup/` |

Same split as the DLC tray: the server in a service, the tray in the user session. BTP and Docker start `uvicorn main:app` and never reach the tray code.

## Personal projects in a sync (a sync is a backup / restore of the whole KH)

| Change | What it does | Where |
|---|---|---|
| Pick them | `/sync/local` lists every project, personal ones flagged `personal`; the Give page shows them with a tag and has 'Tick all (backup)'. | `sync._gives`, `sync.manifest`, `static/home.html` |
| Given only when named | A key gives a personal project only when it names it; a key naming no project still gives every project except personal ones. | `sync._gives`, `sync.export` |
| Receiving | A personal project is made with `personal.ensure` (never registered at Keycloak; its owner is the e-mail in its id) and gets no member list. | `sync.merge_project`, `sync.apply_members`, `sync.create_key` |
| Preferences travel | New default part `personalization` (`kh_personalization_<id>`), so a person's standing instructions come along. | `sync.DEFAULT_PARTS`, `sync.ALL_PARTS` |

The giving KH needs this version to offer personal projects; an older receiver ignores the new part.
