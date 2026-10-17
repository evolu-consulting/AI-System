"""One source of truth for what a contract record holds."""

FIELD_KINDS: dict[str, str] = {
    "number": "text", "title": "text", "type": "enum",
    "supplier_name": "text", "supplier_tax_id": "text", "supplier_address": "text", "supplier_representative": "text",
    "buyer_name": "text", "buyer_tax_id": "text", "buyer_representative": "text",
    "signed_date": "date", "start_date": "date", "end_date": "date", "effective_date": "date",
    "auto_renew": "bool", "notice_days": "int",
    "total_value": "int", "vat_rate": "float", "vat_included": "bool",
    "payment_terms": "text", "delivery_terms": "text", "warranty": "text", "penalty": "text",
}
ITEM_KINDS: dict[str, str] = {
    "code": "text", "name": "text", "spec": "text", "unit": "text", "qty": "float", "unit_price": "int",
    "vat_rate": "float", "moq": "float", "lead_time_days": "int", "valid_from": "date", "valid_to": "date",
}
CONTRACT_TYPES = ("purchase", "service", "framework", "principle")
TOPICS = ("payment", "delivery", "warranty", "penalty", "termination", "renewal", "price",
          "confidentiality", "dispute", "general")
STATUSES = ("extracting", "extract_failed", "needs_review", "active", "expiring", "expired", "renewed", "terminated")
CONFIRMED = {"active", "expiring", "expired", "renewed", "terminated"}
HANDLED_OUTCOMES = ("renewed", "not_renewed", "negotiating", "replaced")
