#!/bin/sh
# test engine from the fork branch source, port 8797, own data; $1 = fake | cli
MODE=${1:-fake}
H=/c/RWTemp/dify-test/$MODE
mkdir -p $H
export LINE_PORT=8797 LINE_HOST=127.0.0.1 LINE_DB=$H/line.db LINE_WORKROOT=$H/work DLC_HOME=$H LINE_RAG=off
export LINE_LLM=$MODE LINE_PROCESS_SOURCE=dify LINE_DIFY_URL=http://127.0.0.1:4203
export LINE_DIFY_FLOWS="$(cat /c/RWTemp/dify-test/flows.env.json)"
[ "$MODE" = fake ] && export LINE_DRY_PACK=todo-pack
# a real model: small caps, no supervised retries; never hand this session's Claude Code env to the CLI agents
[ "$MODE" = cli ] && export LINE_MAX_USD_RUN=3 LINE_SUPERVISOR=0
unset CLAUDE_CODE_CHILD_SESSION CLAUDE_CODE_SESSION_ID CLAUDE_PID CLAUDE_EFFORT CLAUDE_CODE_MESSAGING_SOCKET CLAUDE_CODE_BRIDGE_SESSION_ID CLAUDECODE CLAUDE_CODE_SESSION_ATTENDED CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_EXECPATH CLAUDE_CODE_MESSAGING_TOKEN
cd /c/Workspaces/Personal/RWorkspace-dify/Slaves/SDLC
exec python -u -c "import sys; from line.app_main import main; sys.exit(main(['serve']))" > $H/engine.log 2>&1
