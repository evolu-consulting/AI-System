"""How reputation is weighed, per organisation and role. Defaults as on p06; the owner may change them.

A criterion is built in ("auto": computed from the ledger and contracts) or added by the owner from a fixed list
("manual": a person rates each partner 0–100 on it). Any can be re-weighted, switched off, removed and restored."""
import copy
import re
import uuid

from app.ledger.types import CUSTOMER, SUPPLIER
from app.scoring.labels import LABEL

RULES = {"good_from": 80, "fair_from": 60, "min_events": 3, "window_months": 12,
         "recency_boost": True, "recency_months": 3, "manual_adjust": True}
AUTO, MANUAL = "auto", "manual"
CUSTOM = "custom:"
MAX_CRITERIA, MAX_LABEL = 12, 60
_CUSTOM_KEY = re.compile(r"^custom:[a-z0-9-]{1,40}$")

# ponytail: weights proposed in PLAN §2.4, to be confirmed by the product owner (supplier set has no mock)
_DEFAULTS = {
    CUSTOMER: [("payment_on_time", 35), ("cks_renewal", 20), ("reminders", 15), ("appointments", 10), ("tenure", 10),
               ("complaints", 10)],
    SUPPLIER: [("delivery_on_time", 40), ("complaints", 20), ("reminders", 10), ("tenure", 10), ("price", 20)],
}
KEYS = {role: {k for k, _ in crit} for role, crit in _DEFAULTS.items()}

# What a person can rate by hand, picked from a list (no free text: a typo or a meaningless name would just clutter
# the scoring). Each choice has a fixed key, so removing one and adding it back finds its earlier ratings again.
MANUAL_CHOICES = {
    SUPPLIER: ["Chất lượng hàng", "Đóng gói, bảo quản", "Chứng từ, hoá đơn đầy đủ", "Hỗ trợ sau bán",
               "Tốc độ phản hồi", "Linh hoạt điều khoản", "Thái độ phục vụ", "Đáp ứng đơn gấp"],
    CUSTOMER: ["Thái độ hợp tác", "Tốc độ phản hồi", "Chứng từ, hoá đơn đầy đủ", "Tiềm năng mua thêm",
               "Mức độ gắn bó", "Dễ làm việc", "Giới thiệu khách mới"],
}


def choice_key(label: str) -> str:
    """"Chất lượng hàng" → "custom:chat-luong-hang": the same choice always has the same key."""
    from app.ingest.resolve import search_form
    return CUSTOM + (re.sub(r"[^a-z0-9]+", "-", search_form(label)).strip("-")[:40] or uuid.uuid4().hex[:8])


def addable(cfg: dict) -> list[str]:
    """The hand-rated criteria the role can still add."""
    have = {c["label"] for c in normalise(cfg)["criteria"]}
    return [x for x in MANUAL_CHOICES[cfg["role"]] if x not in have]


def default(role: str) -> dict:
    return normalise({"role": role, "version": 0, "rules": copy.deepcopy(RULES), "updated_by": None, "updated_at": None,
                      "criteria": [{"key": k, "enabled": True, "weight": w} for k, w in _DEFAULTS[role]]})


def _criterion(c: dict) -> dict:
    manual = c.get("kind") == MANUAL or (c.get("key") or "").startswith(CUSTOM)
    label = (c.get("label") or "").strip() or None
    key = c.get("key") or (choice_key(label) if manual and label else f"{CUSTOM}{uuid.uuid4().hex[:8]}")
    if not manual:
        label = LABEL.get(key, key)          # a built-in keeps its own name
    return {"key": key, "kind": MANUAL if manual else AUTO, "label": label, "enabled": bool(c.get("enabled")),
            "weight": c.get("weight")}


def normalise(cfg: dict) -> dict:
    """Every criterion with its kind and label; configs stored before criteria were editable read the same way."""
    return {**cfg, "criteria": [_criterion(c) for c in cfg["criteria"]]}


def labels(cfg: dict) -> dict[str, str]:
    return {c["key"]: c.get("label") or LABEL.get(c["key"], c["key"]) for c in cfg["criteria"]}


def manual_keys(cfg: dict) -> list[str]:
    return [c["key"] for c in normalise(cfg)["criteria"] if c["kind"] == MANUAL]


def restorable(cfg: dict) -> list[dict]:
    """Built-ins the owner removed, with their default weight, for "Khôi phục tiêu chí có sẵn"."""
    have = {c["key"] for c in cfg["criteria"]}
    return [{"key": k, "label": LABEL[k], "weight": w} for k, w in _DEFAULTS[cfg["role"]] if k not in have]


def problem(cfg: dict) -> str | None:
    """Why a config cannot be saved, in the words the page shows; None when it can."""
    crit, rules = normalise(cfg)["criteria"], cfg["rules"]
    if len(crit) > MAX_CRITERIA:
        return f"Tối đa {MAX_CRITERIA} tiêu chí"
    if len({c["key"] for c in crit}) != len(crit):
        return "Tiêu chí bị trùng"
    seen: set[str] = set()
    for c in crit:
        if c["kind"] == MANUAL and not _CUSTOM_KEY.match(c["key"]):
            return "Mã tiêu chí không hợp lệ"
        if c["kind"] == AUTO and c["key"] not in KEYS[cfg["role"]]:
            return f"Tiêu chí có sẵn không hợp lệ: {c['key']}"
        if not c["label"]:
            return "Tên tiêu chí không được để trống"
        if c["kind"] == MANUAL and c["label"] not in MANUAL_CHOICES[cfg["role"]]:
            return f"Chọn tiêu chí tự chấm trong danh sách: {c['label']} không có"
        if len(c["label"]) > MAX_LABEL:
            return f"Tên tiêu chí tối đa {MAX_LABEL} ký tự"
        if c["label"].casefold() in seen:
            return f"Tên tiêu chí bị trùng: {c['label']}"
        seen.add(c["label"].casefold())
    if any(not isinstance(c["weight"], int) or isinstance(c["weight"], bool) or not 0 <= c["weight"] <= 100 for c in crit):
        return "Trọng số phải từ 0 đến 100"
    if not any(c["enabled"] for c in crit):
        return "Cần bật ít nhất một tiêu chí"
    if sum(c["weight"] for c in crit if c["enabled"]) != 100:
        return "Tổng trọng số phải đúng 100%"
    if not 0 < rules["fair_from"] < rules["good_from"] <= 100:
        return "Mức Tốt phải cao hơn mức Khá"
    if not 1 <= rules["window_months"] <= 60 or not 1 <= rules["recency_months"] <= rules["window_months"]:
        return "Khoảng thời gian không hợp lệ"
    if not 0 <= rules["min_events"] <= 100:
        return "Số sự kiện tối thiểu không hợp lệ"
    return None
