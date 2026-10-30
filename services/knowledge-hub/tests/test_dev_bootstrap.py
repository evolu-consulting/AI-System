"""app/dev_bootstrap.py: the DEV-ONLY static maintainer token is off by default and refused on prod-like stores.

No network, no database: the gate only reads the environment and app.config.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from app import auth, config, dev_bootstrap  # noqa: E402

FAILURES = []
TOKEN = "t" * 40
ENV = ("KH_DEV_BOOTSTRAP", "KH_DEV_BOOTSTRAP_TOKEN", "VCAP_APPLICATION", "VCAP_SERVICES", "CF_INSTANCE_GUID")


def check(name, cond, detail=None):
    print(("ok   " if cond else "FAIL ") + name + ("" if cond or detail is None else f"  -> {detail}"))
    if not cond:
        FAILURES.append(name)


def state(env: dict, store="sqlite", schema="KNOWLEDGE_HUB", host="localhost") -> bool:
    for k in ENV:
        os.environ.pop(k, None)
    os.environ.update(env)
    config.STORE_BACKEND, config.HANA_SCHEMA, config.HANA_HOST = store, schema, host
    dev_bootstrap._state.clear()
    return dev_bootstrap.matches(dev_bootstrap.PREFIX + env.get("KH_DEV_BOOTSTRAP_TOKEN", TOKEN))


ON = {"KH_DEV_BOOTSTRAP": "1", "KH_DEV_BOOTSTRAP_TOKEN": TOKEN}
check("off by default (token set, switch unset)", not state({"KH_DEV_BOOTSTRAP_TOKEN": TOKEN}))
check("on with SQLite", state(ON))
check("on with a non-default local HANA schema", state(ON, "hana", "KH_STAGEF"))
check("refused on the default HANA schema KNOWLEDGE_HUB", not state(ON, "hana", "KNOWLEDGE_HUB"))
check("refused on HANA Cloud", not state(ON, "hana", "KH_STAGEF", "x.hana.prod-eu10.hanacloud.ondemand.com"))
check("refused on Cloud Foundry", not state({**ON, "VCAP_APPLICATION": "{}"}))
check("refused with a short token", not state({"KH_DEV_BOOTSTRAP": "1", "KH_DEV_BOOTSTRAP_TOKEN": "short"}))
state(ON)
check("a wrong token does not match", not dev_bootstrap.matches(dev_bootstrap.PREFIX + "x" * 40))
p = auth.principal_of(dev_bootstrap.PREFIX + TOKEN)
check("the dev token is a maintainer person (not a namespace service token)",
      p is not None and p.is_maintainer and p.ns is None and p.email == "dev-admin@kh.local", p)
check("the dev maintainer may write worklogs on any project (project.log, for seeding a dev box)",
      p is not None and {"project.read", "project.write", "project.log"} <= set(p.every_project), p)
state({})
try:
    auth.principal_of(dev_bootstrap.PREFIX + TOKEN)
    refused = False
except Exception:  # noqa: BLE001 - falls through to Keycloak verification, which rejects it
    refused = True
check("switched off, the dev token falls through to normal verification and is rejected", refused)

print()
print(f"{len(FAILURES)} failure(s)" if FAILURES else "all passed")
sys.exit(1 if FAILURES else 0)
