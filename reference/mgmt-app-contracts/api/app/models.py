from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, model_validator

Domain = Literal["general", "contract"]
EntityType = Literal["Person", "Project", "Team", "Product", "Concept", "Decision"]


class Entity(BaseModel):
    name: str
    type: EntityType

    @property
    def key(self) -> str:
        return f"{self.type}:{self.name.strip().lower()}"


class Relation(BaseModel):
    src: str
    dst: str
    type: str


class Extraction(BaseModel):
    entities: list[Entity]
    relations: list[Relation]


class SimilarVerdict(BaseModel):
    verdict: Literal["DUPLICATE", "CONFLICT", "RELATED"]
    reason: str


class Document(BaseModel):
    id: str
    source_type: Literal["upload", "gdrive", "slack", "jira"]
    source_id: str
    title: str
    uri: str
    content_hash: str
    status: str = "pending"
    error: str | None = None
    chunk_count: int = 0
    created_at: datetime
    updated_at: datetime
    domain: Domain = "general"


class Score(BaseModel):
    index: int
    relevance: int


class Rerank(BaseModel):
    scores: list[Score]


class AliasVerdict(BaseModel):
    same: bool
    reason: str


class QueryRequest(BaseModel):
    question: str
    chat_id: str | None = None
    scope: Literal["general", "contracts"] = "general"
    contract_ids: list[str] | None = None
    ui: Literal["text", "a2ui"] = "text"   # a2ui: the contract answer streams as an A2UI surface


class Citation(BaseModel):
    n: int
    doc_id: str
    title: str
    uri: str
    snippet: str


class QText(BaseModel):
    value: str | None
    quote: str


class QDate(BaseModel):
    value: date | None
    quote: str


class QInt(BaseModel):
    value: int | None
    quote: str


class QFloat(BaseModel):
    value: float | None
    quote: str


class QBool(BaseModel):
    value: bool | None
    quote: str


class QType(BaseModel):
    value: Literal["purchase", "service", "framework", "principle"] | None
    quote: str


class ExtractedItem(BaseModel):
    code: str | None
    name: str
    spec: str | None
    unit: str | None
    qty: float | None
    unit_price: int | None
    vat_rate: float | None
    moq: float | None
    lead_time_days: int | None
    valid_from: date | None
    valid_to: date | None
    quote: str


class ExtractedClause(BaseModel):
    number: str
    topic: Literal["payment", "delivery", "warranty", "penalty", "termination", "renewal", "price",
                   "confidentiality", "dispute", "general"]


class ContractExtraction(BaseModel):
    number: QText
    title: QText
    type: QType
    supplier_name: QText
    supplier_tax_id: QText
    supplier_address: QText
    supplier_representative: QText
    buyer_name: QText
    buyer_tax_id: QText
    buyer_representative: QText
    signed_date: QDate
    start_date: QDate
    end_date: QDate
    effective_date: QDate
    auto_renew: QBool
    notice_days: QInt
    total_value: QInt
    vat_rate: QFloat
    vat_included: QBool
    payment_terms: QText
    delivery_terms: QText
    warranty: QText
    penalty: QText
    items: list[ExtractedItem]
    clauses: list[ExtractedClause]

    @model_validator(mode="before")
    @classmethod
    def _late_fields(cls, data):
        """A field added later (buyer_representative) stays required in the schema the model is given, but an answer
        stored or returned without it reads as "not stated"."""
        if isinstance(data, dict):
            for name in ("buyer_representative",):
                data.setdefault(name, {"value": None, "quote": ""})
        return data

    @classmethod
    def empty(cls) -> "ContractExtraction":
        blank = {name: {"value": None, "quote": ""} for name in cls.model_fields if name not in ("items", "clauses")}
        return cls.model_validate({**blank, "items": [], "clauses": []})
