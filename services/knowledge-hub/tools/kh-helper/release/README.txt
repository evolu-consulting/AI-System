Knowledge Hub helper (kh-helper) {version}

Connects Claude Code (and Grok, Codex, Gemini CLI) to Knowledge Hub: sign-in, hooks and the MCP server.

INSTALL OR UPGRADE
  Windows:        powershell -ExecutionPolicy Bypass -File install.ps1
  macOS / Linux:  bash install.sh
  Another CLI profile: install.ps1 -ProfileDir <folder>  /  bash install.sh <folder>
  Then close the CLI and open it again.

Already installed? Later versions install themselves: at session start the helper says when a newer one is
published, and the assistant runs  "<profile>/kh-helper/Scripts/python" -m kh_helper.cli upgrade .

sha256 of the wheel: {wheel_sha256}
