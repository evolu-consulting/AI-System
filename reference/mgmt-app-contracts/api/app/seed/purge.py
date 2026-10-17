"""Remove a trial organisation and everything it holds (contracts, graph, ledger, CKS, prices, chats, memberships).

    python -m app.seed.purge --owner lan@mgmt.test [--drop-users]

Accounts stay unless --drop-users: a person may belong to another organisation later. Public market prices
(org_id "*") are shared and never touched."""
import argparse

from app import orgs
from app.contracts import project, store
from app.store import graph
from app.store import opensearch as os_store


def purge(org_id: str, drop_users: bool = False, keep_logs: bool = False) -> dict:
    members = [m["email"] for m in orgs.members(org_id)]
    contracts = store.list_org(org_id)
    for rec in contracts:
        project.delete_projection(rec["id"])
        store.delete(rec["id"])
    graph._run("MATCH (n) WHERE n.key STARTS WITH $p DETACH DELETE n", p=f"{org_id}|")   # its products and parties
    keep = {os_store.USERS, os_store.SESSIONS, os_store.ORGS} | ({os_store.APP_LOGS, os_store.CHATS, os_store.FEEDBACK} if keep_logs else set())
    names = [n for n in os_store._MAPPINGS if n not in keep]
    r = os_store.client().delete_by_query(index=",".join(names), body={"query": {"term": {"org_id": org_id}}},
                                          refresh=True, conflicts="proceed", ignore_unavailable=True)
    os_store.client().delete(index=os_store.ORGS, id=org_id, ignore=[404], refresh=True)
    if drop_users:
        for e in members:
            os_store.client().delete(index=os_store.USERS, id=e, ignore=[404], refresh=True)
            os_store.client().delete_by_query(index=os_store.SESSIONS, body={"query": {"term": {"email": e}}},
                                              refresh=True, conflicts="proceed")
    return {"contracts": len(contracts), "records": r.get("deleted", 0), "members": members}


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--owner", required=True)
    p.add_argument("--drop-users", action="store_true")
    a = p.parse_args()
    m = orgs.membership(a.owner.strip().lower())
    if not m or m["role"] != "owner":
        raise SystemExit(f"{a.owner} không phải chủ tổ chức nào")
    print(purge(m["org_id"], a.drop_users))
