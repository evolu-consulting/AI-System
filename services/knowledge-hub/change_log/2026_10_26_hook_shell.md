# kh-helper 1.18.1: hook commands every shell can run (2026-10-26)

## Why

On a machine without Git for Windows, Claude Code runs hooks with PowerShell. setup wrote each hook as
`"C:\...\python.exe" -m kh_helper.cli hook <Event>`, and PowerShell reads a leading quoted path as a string, not a
command. Every KH hook failed with `ParserError: Unexpected token '-m' in expression or statement` (seen as a
'Stop hook error' line, 2026-10-26). The install gave no sign of it.

## How

- **`hooks.hook_exe()`** writes the helper's python in a form the hook's shell can run:
  - Windows, no spaces in the path: unquoted with forward slashes. It runs in PowerShell, Git Bash and cmd.
  - Windows, spaces: the 8.3 short name. Only if the volume has none is the shell guessed: quoted for Git Bash,
    `& "..."` for PowerShell (then setup must run again if Git for Windows is added later).
  - macOS/Linux: quoted, as before.
  - Used by the Claude Code hooks and the Grok hooks file.
- **setup checks it**: `hook_shells` in its output runs `<python> --version` the way the hooks start, in each shell
  found (Git Bash, PowerShell; sh off Windows), and says `ok` or `failed: ...`.
- **install.ps1 / install.sh** warn when a shell fails, instead of hiding setup's output.
- **Already installed machines**: `hooks_note` marks a hook whose command is not the current form as out of date,
  so the assistant runs setup. The MCP server's instructions carry the same note, since a hook PowerShell cannot
  start never shows its own.
- `/auth/download` steps: check `hook_shells` after setup.

## Tests

- `tests/test_kh_helper_hookshell.py`: the four command forms, setup's `hook_shells`, the note on old hooks, and a
  real run of the written command in pwsh, Windows PowerShell and Git Bash.
- `tests/test_kh_helper_home.py`: expects the new command form.
