# Download sources: /auth/download takes each module from the DB (2026-10-24)

## Why

`/auth/help` told every new install to `pip install` the wheel that `deploy/btp/push.ps1` bundled into the app.
So the install path depended on the last KH deploy. On 2026-10-24 it served a 1.18.0 wheel that lacked the
1.17.2 fixes, while the official release (row `ver_kh-helper`, the upgrade path) was the Google Drive zip.

## How (Rowan's design)

- **The table.** `kh_download_source` holds one row per module (`kh-helper` first): type, path, version,
  sha256, file name, notes. A maintainer sets it with `PUT /downloads/{module}`; `GET /downloads` lists the
  rows and `DELETE` removes one.
- **type local.** The path is a file on the app's own host, relative to the app folder (e.g.
  `downloads/kh_helper-1.18.0-py3-none-any.whl`). `GET /auth/download/<module or file name>` streams it.
  - When setting a path, KH refuses one that leaves the app folder, an absolute path, a drive path, a URL or
    a missing file.
  - A file that disappears later answers 503 and never another file.
- **type https.** The path is a public https link. A Google Drive share link is turned into its direct form.
  `GET /auth/download/<module>` answers JSON with:
  - the link and its direct form;
  - version, sha256 and file name;
  - `steps` for an assistant: download with `curl -L`, check the PK bytes and the sha256, unzip, then pip
    install the wheel inside, or run `install.ps1` / `install.sh`.
- **/auth/help and /auth/config.**
  - With an https source, step 1 of `/auth/help` installs the wheel file of that zip and points at the JSON.
  - With a local source, step 1 pip-installs its file URL.
  - `/auth/config` names the same route and version.
- **No row.** Nothing changes: the uploaded artifact or the bundled wheel is served as before.

## Code

- `app/downloads.py` (new), `app/auth.py` (`/auth/download`, `/auth/help`, `/auth/config`), `main.py`,
  `app/auth_rules.json`.
- Tests: `tests/test_downloads.py` (new).
- Live check on a local KH with the real sign-in: the Drive source was set; a signed-out GET returned the
  link and the steps; following them downloaded the 60657-byte zip (PK, sha256 matching) and installed
  kh-helper 1.18.0 into a fresh venv.
