' Start the KH SDLC tool with no console window: http://127.0.0.1:8795
'
' Same launcher as RITA's start-rita.vbs: pythonw with output redirected into
' logs\sdlc.log, the launching Claude session's private variables dropped so
' agent CLIs do not think they are nested inside it.
'
' ONE DIFFERENCE: CLAUDE_CONFIG_DIR is KEPT, and when it is not set the
' profile at %USERPROFILE%\.claude_rowan is used if it exists. The agents are
' Claude CLI calls and must run under the same Claude login as fen's sessions;
' double-clicking this file would otherwise fall back to the default profile.

Option Explicit

Dim shell, fso, here, command, name, sessionVars, profile

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = here
shell.Environment("PROCESS")("PYTHONIOENCODING") = "utf-8"

sessionVars = Array( _
  "CLAUDECODE", _
  "CLAUDE_CODE_CHILD_SESSION", _
  "CLAUDE_CODE_ENTRYPOINT", _
  "CLAUDE_CODE_EXECPATH", _
  "CLAUDE_CODE_MESSAGING_SOCKET", _
  "CLAUDE_CODE_MESSAGING_TOKEN", _
  "CLAUDE_CODE_SESSION_ATTENDED", _
  "CLAUDE_CODE_SESSION_ID", _
  "CLAUDE_EFFORT", _
  "CLAUDE_PID")

For Each name In sessionVars
  shell.Environment("PROCESS").Remove name
Next

If shell.Environment("PROCESS")("CLAUDE_CONFIG_DIR") = "" Then
  profile = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\.claude_rowan"
  If fso.FolderExists(profile) Then
    shell.Environment("PROCESS")("CLAUDE_CONFIG_DIR") = profile
  End If
End If

If Not fso.FolderExists(fso.BuildPath(here, "logs")) Then
  fso.CreateFolder fso.BuildPath(here, "logs")
End If

command = "cmd /c pythonw -u sdlc.py serve >> logs\sdlc.log 2>&1"
shell.Run command, 0, False
