"""Auth helpers for KH BTP prod as agent-admin; the token is refreshed before it expires."""
import json, time, urllib.parse, urllib.request
import os
from pathlib import Path
A = json.load(open(Path(os.environ.get("KH_BENCH_SECRETS", Path.home() / ".claude_rowan" / "secrets")) / "kh-prod-accounts.json"))
ISSUER = A["keycloak"] + "/realms/knowledge-hub"
_T = {"tok": None, "at": 0}

def tok():
    if time.time() - _T["at"] > 200:
        body = urllib.parse.urlencode({"grant_type": "password", "client_id": "kh-test-password", "username": "agent-admin",
                                       "password": A["accounts"]["agent-admin"]["password"]}).encode()
        _T["tok"] = json.load(urllib.request.urlopen(ISSUER + "/protocol/openid-connect/token", body, timeout=60))["access_token"]
        _T["at"] = time.time()
    return _T["tok"]

def req(base, method, path, body=None):
    r = urllib.request.Request(base + path, method=method, data=None if body is None else json.dumps(body).encode(),
                               headers={"Authorization": "Bearer " + tok(), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=120) as x:
            raw = x.read(); return x.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:400].decode(errors="replace")
    except (urllib.error.URLError, OSError) as e:   # DNS / connection blips
        return 0, str(e)

kh = lambda m, p, b=None: req(A["kh"], m, p, b)
ident = lambda m, p, b=None: req(ISSUER + "/kh/", m, p, b)
