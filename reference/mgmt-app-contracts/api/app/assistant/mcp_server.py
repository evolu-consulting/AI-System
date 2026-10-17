"""The app's tools as an MCP server (stdio), for the Claude Code CLI behind the assistant panel (assistant/cli.py).

It holds no rights of its own: every call goes to this API (/assistant/tools) with the short session made for one
question of one person (env MGMT_SESSION), so the CLI can see and change exactly what that person can, no more.
Standalone on purpose (only httpx): it starts per question and must start fast.

    python app/assistant/mcp_server.py      # env: MGMT_API, MGMT_SESSION"""
import json
import os
import sys

import httpx

PROTOCOL = "2025-06-18"


def _api() -> httpx.Client:
    return httpx.Client(base_url=os.environ["MGMT_API"].rstrip("/") + "/assistant", timeout=120,
                        cookies={"session": os.environ["MGMT_SESSION"]})


class _Retry:
    """The API may be restarting (a deploy, a dev reload): try a request again for a few seconds before failing."""

    def __init__(self, client, tries: int = 15, wait: float = 2.0):     # ~30 s: a dev reload or a deploy restart
        self.client, self.tries, self.wait = client, tries, wait

    def _go(self, fn, *a, idempotent: bool, **kw):
        import time
        for i in range(self.tries):
            try:
                r = fn(*a, **kw)
                if r.status_code < 500 or not idempotent or i == self.tries - 1:
                    return r
            except (httpx.ConnectError if not idempotent else httpx.TransportError):   # a write is retried only
                if i == self.tries - 1:                                             # when it never reached the API
                    raise
            time.sleep(self.wait)

    def get(self, *a, **kw):
        return self._go(self.client.get, *a, idempotent=True, **kw)

    def post(self, *a, **kw):
        return self._go(self.client.post, *a, idempotent=False, **kw)


def handle(msg: dict, client: httpx.Client) -> dict | None:
    """One JSON-RPC message in, its response out (None for notifications)."""
    method, mid = msg.get("method"), msg.get("id")
    if mid is None:
        return None
    try:
        if method == "initialize":
            result = {"protocolVersion": msg.get("params", {}).get("protocolVersion") or PROTOCOL,
                      "capabilities": {"tools": {}}, "serverInfo": {"name": "mgmt", "version": "1"}}
        elif method == "ping":
            result = {}
        elif method == "tools/list":
            r = client.get("/tools")
            r.raise_for_status()
            result = {"tools": [{"name": t["name"], "description": t["description"], "inputSchema": t["input_schema"]}
                                for t in r.json()]}
        elif method == "tools/call":
            p = msg.get("params", {})
            r = client.post(f"/tools/{p['name']}", json=p.get("arguments") or {})
            if r.status_code != 200:
                result = {"content": [{"type": "text", "text": f"Lỗi {r.status_code}"}], "isError": True}
            else:
                body = r.json()
                result = {"content": [{"type": "text", "text": body["text"]}], "isError": bool(body.get("is_error"))}
        else:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"unknown method {method}"}}
    except Exception as e:  # noqa: BLE001 - the CLI gets an error result, the server keeps serving
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32000, "message": type(e).__name__}}
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def main() -> None:
    with _api() as raw:
        client = _Retry(raw)
        for line in sys.stdin:
            if not line.strip():
                continue
            out = handle(json.loads(line), client)
            if out is not None:
                sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
                sys.stdout.flush()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
    main()
