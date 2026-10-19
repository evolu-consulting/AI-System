"""I1 · bổ sung cho seed demo của mgmt-app (CHỈ bản sao evotest-mgmt, dữ liệu bịa): thành viên + cấp quản lý (luật thấy),
HĐ chưa giao, phụ lục, HĐ có file đính kèm, tài liệu tri thức chung + đồ thị thực thể, nhắc đã gửi, thông báo, góp ý, hẹn nhắc.
Chạy trong container api (cwd /app):  SEED_PASSWORD=… python /seed/seed-plus.py <owner email>
Idempotent: id cố định; chạy lại không nhân đôi."""
import hashlib
import os
import sys
from datetime import datetime, timezone

from app import auth, orgs
from app.contracts import store
from app.contracts.manual import create
from app.ledger import followups
from app.models import Document
from app.settings import settings
from app.store import docs, graph
from app.store import opensearch as os_store

OWNER = sys.argv[1].strip().lower()
PW = os.environ["SEED_PASSWORD"]
NOW = datetime.now(timezone.utc).isoformat()
TEAM = [("m1@annam.test", "editor", None), ("e1@annam.test", "editor", "m1@annam.test"),
        ("v1@annam.test", "viewer", "e1@annam.test")]


def team(org_id: str) -> None:
    for email, role, manager in TEAM:
        if not auth.get_user(email):
            auth.create_user(email, email.split("@")[0], PW, role=None)
        if not orgs.membership(email):
            orgs.invite(org_id, email, role, manager, OWNER)
            orgs.activate(email)


def reassign(org_id: str) -> None:
    """Chủ HĐ theo người: kế toán ⇒ m1, rau ⇒ e1, VPP ⇒ v1; Hưng Phát chưa giao (e1 tạo); suất ăn 2024 = phụ lục của 2025."""
    p = f"demo-{org_id[:8]}-"
    for key, owner in (("acc", "m1@annam.test"), ("veg", "e1@annam.test"), ("vpp", "v1@annam.test")):
        r = store.get(p + key)
        if r and r.get("owner_email") != owner:
            store.save({**r, "owner_email": owner})
    r = store.get(p + "hp")
    if r and r.get("owner_email"):
        store.save({**r, "owner_email": None, "created_by": "e1@annam.test"})
    r = store.get(p + "old-meal")
    if r and r.get("kind") != "addendum":
        store.save({**r, "kind": "addendum", "parent_id": p + "old-meal2", "owner_email": None})


def with_file(org_id: str) -> None:
    cid = f"i1file-{org_id[:8]}"
    raw = b"%PDF-1.4\n% I1 evotest-mgmt hop dong mau\n"
    path = os.path.join(settings.contract_files_dir, org_id, cid)
    os.makedirs(path, exist_ok=True)
    with open(os.path.join(path, "hop-dong-mau.pdf"), "wb") as f:
        f.write(raw)
    if store.get(cid):
        return
    create(org_id, OWNER, {"number": "HDM-01", "title": "Hợp đồng có file", "total_value": 15_000_000,
                           "end_date": "2027-01-31"}, items=[{"name": "Bảo trì", "unit": "tháng", "qty": 12, "unit_price": 1_250_000}],
           origin="manual", direction="sale", lookup=False, contract_id=cid,
           extra={"file": {"name": "hop-dong-mau.pdf", "size": len(raw), "mime": "application/pdf"}})


def knowledge() -> None:
    """Một tài liệu chung (nội bộ) + 2 đoạn + thực thể/REL/SIMILAR như ingest thật làm (vector giả, không gọi mô hình)."""
    did = "i1-doc-quy-trinh"
    text = ["Chị Tiên phụ trách dự án Apollo.", "Dự án Apollo báo cáo hằng tuần cho chị Tiên."]
    doc = Document(id=did, source_type="upload", source_id="upload:i1", title="Quy trình dự án", uri="upload://quy-trinh.md",
                   content_hash=hashlib.sha256("\n".join(text).encode()).hexdigest(), status="done", chunk_count=2,
                   created_at=NOW, updated_at=NOW, domain="general")
    os_store.upsert_document(doc)
    ents = [{"key": "Person:chị tiên", "name": "Chị Tiên", "type": "Person"}, {"key": "Project:apollo", "name": "Apollo", "type": "Project"}]
    chunks = [{"id": f"{did}:{i}", "index": i, "entities": ents, "relations": [{"src": "Person:chị tiên", "dst": "Project:apollo",
              "type": "LEADS"}] if i == 0 else []} for i in range(2)]
    os_store.index_chunks([{"id": c["id"], "doc_id": did, "chunk_index": c["index"], "text": text[c["index"]],
                            "embedding": [0.1] * settings.embed_dim, "source_type": "upload", "title": doc.title, "uri": doc.uri,
                            "entities": [e["key"] for e in ents], "domain": "general"} for c in chunks])
    graph.upsert_document(doc, chunks)
    graph.add_similar(f"{did}:0", f"{did}:1", 0.93)


def extras(org_id: str) -> None:
    acc = f"demo-{org_id[:8]}-acc"
    rec = store.get(acc)
    deadline = (rec or {}).get("action_deadline") or "2026-12-01"
    os_store.set_state(f"remind:{acc}:{deadline}:30:m1@annam.test", {"at": NOW, "sent": ["inapp"]})
    if not docs.get(os_store.NOTIFICATIONS, "i1-noti-1"):
        docs.save(os_store.NOTIFICATIONS, {"id": "i1-noti-1", "user_email": "m1@annam.test", "contract_id": acc, "milestone": 30,
                                           "title": "Sắp đến hạn", "body": "HĐ kế toán", "link": f"/contracts/{acc}", "read_at": None})
    if not docs.get(os_store.FEEDBACK, "i1-fb-1"):
        docs.save(os_store.FEEDBACK, {"id": "i1-fb-1", "org_id": org_id, "by": "e1@annam.test", "at": NOW, "source": "form",
                                      "kind": "đề xuất", "description": "Thêm lọc theo phòng"})
    followups.upsert(org_id, "e1@annam.test", "2026-11-15T09:00:00+07:00", "Gọi Bếp Việt", "/ledger", "obligation", f"{acc}-2",
                     "e1@annam.test")


m = orgs.membership(OWNER)
if not m:
    raise SystemExit(f"{OWNER} chưa có tổ chức (chạy app.seed.demo --create trước)")
team(m["org_id"])
reassign(m["org_id"])
with_file(m["org_id"])
knowledge()
extras(m["org_id"])
print("seed-plus", m["org_id"])
