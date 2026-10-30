# For Claude Code: connect this machine to the new KH install

You are Claude Code on a machine that should use a freshly installed Knowledge Hub (KH). Probably nothing
of KH is set up here yet: no kh-helper, no KH hooks, no `knowledge-hub` MCP server. Do the steps below in
order. They need no administrator rights.

## 0. Facts you need (ask the person only for what you cannot find)

| What | Where to find it |
|---|---|
| KH address `<KH_URL>` | The person tells you, e.g. `http://localhost:9000` on the KH server itself, `http://<server-name>:9000` elsewhere. Check: `Invoke-RestMethod <KH_URL>/health` answers. |
| This folder | The folder holding this file: `C:\KH\kh-helper` on the KH server, or the `payload\kh-helper` folder of the KH_Setup copy. |
| Claude profile | `$env:CLAUDE_CONFIG_DIR` when set, else `~\.claude`. kh-helper goes into `<profile>\kh-helper`. |

Never ask for, type or store a password, token or code yourself. The person signs in in the browser.

## 1. Run the setup script

```
"<this folder>\setup-kh-helper.cmd" --kh-url <KH_URL>
```

It runs on a small Python bundled in `<this folder>\python`, so a locked-down PowerShell does not matter.

It installs Python 3.12 for this user if no Python 3.10+ exists, creates `<profile>\kh-helper` (a venv),
installs kh-helper {{HELPER_VERSION}} offline from `wheels\`, checks KH, runs `kh login`, then `kh setup`.

- `kh login` opens a browser on the KH Keycloak and waits. Tell the person, in one line, to sign in
  there with their KH e-mail. On the first sign-in of the install's admin, the password is the one-time
  password from `C:\KH\secrets\kh-accounts.json` on the KH server (only an administrator can read it);
  Keycloak then asks for a new one.
- If you run commands without a terminal the person can see, use `--no-login`, then ask the person to run
  `! "<profile>\kh-helper\Scripts\python" -m kh_helper.cli login --kh-url <KH_URL>` themselves, and run
  the script again with `--no-login` (it is safe to repeat) so `kh setup` and the checks run.
- No browser on this machine: the person runs `... kh_helper.cli login --no-browser --kh-url <KH_URL>`,
  which prints a link and a code to open on another device.

## 2. Check

The script ends with these; run them again if you are unsure:

```powershell
$kh = "<profile>\kh-helper\Scripts\python"
& $kh -m kh_helper.cli --kh-url <KH_URL> me                         # the person's e-mail and role
& $kh -m kh_helper.cli --kh-url <KH_URL> call GET /hooks/list        # count 5 (the Prod kernel)
& $kh -m kh_helper.cli --kh-url <KH_URL> call GET /policy/actions    # count 18
```

Then tell the person to restart Claude Code. In the new session the SessionStart hook shows
"KNOWLEDGE HUB KERNEL" and each prompt gets a "KH TURN CONTEXT"; from then on follow the kernel.

## 3. If something fails

| Symptom | Do this |
|---|---|
| `<KH_URL>/health` does not answer | KH runs as scheduled task "KH Server" on the server. On another machine: firewall port 9000 and the install's `--public-host`. |
| `kh login` ends with an issuer or 401 error | Use exactly the host name the server was installed with (`KH_AUTH_ISSUER` in `C:\KH\kh\.env`); `localhost` and the machine name are different issuers. |
| Python is not 3.12 and there is no internet | Install the bundled `python-3.12.10-amd64.exe`, delete `<profile>\kh-helper`, run the script again. |
| `kh setup` reports the MCP server was not added (e.g. `claude` not on PATH) | Add it by hand: `claude mcp add knowledge-hub -- "<profile>\kh-helper\Scripts\python" -m kh_helper.cli --kh-url <KH_URL> mcp` |
| A machine already used KH Prod | Fine: `kh login --kh-url <KH_URL>` adds the new install; `kh setup` with `--kh-url` points hooks and MCP at it. |

KH explains the same steps itself, with the right links: `Invoke-RestMethod <KH_URL>/auth/help`.
