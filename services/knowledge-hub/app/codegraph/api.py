"""
Code-graph import API (additive) — ingest a code-graph supplied in the FIXED KH
CONTRACT and materialise it into KH's own substrate (per-project ChromaDB collection
+ per-project Kùzu graph), queryable natively.

    POST /codegraph/import  {source_id, tool, nodes[], edges[]}   (tool = metadata only)

TOOL-AGNOSTIC (B8, fen 2026-08-20): tools are plug-in/plug-out, so KH does NOT parse
any tool's native format. A tool-side adapter (tools/adapters/*) reads its own output
(graphify graph.json, gitnexus .gitnexus dump, ...) and converts it to this contract:
    node = {id, label, code_type, attr_type, source_file, source_location}
    edge = {source, target, relation, confidence, source_file?, source_location?}
KH only ever sees the contract. Adding a new tool = a new adapter, zero KH change.

Policy alignment (codegraph-plugins/code-scan-model):
  [2 ISOLATION] every node/edge id is namespaced `<source_id>__<id>` in BOTH the
                vector collection and the graph, so same-named entities across
                sources never blend. Vectors land in the source's OWN collection.
  [7 PERSIST]   this is the INGEST step. DEFER-IMPORT: /codegraph/federated queries a
                KH-contract file directly; import into the DB only when asked.

Reuses the same primitives as /graph/add and /orchestrator/ingest:
  embed_entities → vs.upsert_src (per-source vectors) + graph_db.upsert_nodes/edges.
"""
from __future__ import annotations

import logging
import os

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field

from app.extractor import embed_entities
from app.graph_db.project_graph import get_project_graph
from app import vector_store as vs
from app import projects as kh_projects
from app.projects import assert_canonical_id

logger = logging.getLogger(__name__)


# ── request / response ───────────────────────────────────────────────────────

class ContractNode(BaseModel):
    """One node of the FIXED KH import contract (tool-agnostic).

    A tool-side adapter (tools/adapters/*) converts its own output into this shape.
    KH never parses a tool's native format — it only ingests this contract.
    """
    id: str = Field(..., description="Node id within the source (pre-namespace); KH prefixes it <source_id>__.")
    label: str = Field(..., description="Human/display label of the node.")
    code_type: str = Field(default="", description="Fine-grained kind: module/class/function/basicblock/... (drives tier + no-stub).")
    attr_type: str = Field(default="ENTITY", description="KH graph NodeType for this node.")
    source_file: str = Field(default="", description="File the node lives in.")
    source_location: str = Field(default="", description="Line/col or range within the file.")


class ContractEdge(BaseModel):
    """One edge of the FIXED KH import contract (tool-agnostic)."""
    source: str = Field(..., description="Source node id (pre-namespace).")
    target: str = Field(..., description="Target node id (pre-namespace).")
    relation: str = Field(default="RELATED_TO", description="KH relation label (IMPORTS/CALLS/ACCESSES/...).")
    confidence: float = Field(default=1.0, description="0..1 confidence (extracted=1.0, inferred<1).")
    source_file: str = Field(default="", description="Optional edge provenance file.")
    source_location: str = Field(default="", description="Optional edge provenance location.")


class CodegraphImportRequest(BaseModel):
    tool: str = Field(
        default="",
        description="Which adapter produced this contract (graphify/gitnexus/...). METADATA ONLY — "
                    "KH does not branch on it; it is stamped on nodes/edges/vectors for provenance.",
    )
    nodes: list[ContractNode] = Field(
        default_factory=list,
        description="Nodes in the FIXED KH contract. The tool-side adapter has already converted from "
                    "the tool's native format; KH ingests them as-is (no tool parsing inside KH).",
    )
    edges: list[ContractEdge] = Field(
        default_factory=list,
        description="Edges in the FIXED KH contract.",
    )
    source_id: str = Field(
        ...,
        description="Orchestrator source id for this codebase; every id is prefixed <source_id>__ (ISOLATION).",
    )
    topic: str = Field(
        default="codegraph",
        description="Topic namespace tagged on every imported vector (metadata.topic) so a query can scope WITHIN the source and never mix code-graph nodes with other topics of the same source.",
    )
    conflicts_with: list[str] = Field(
        default_factory=list,
        description="Other source_ids this codebase must never blend with (e.g. a fork / same-named template). Recorded on the manifest entry so facet-descent keeps them separated.",
    )
    register_source: bool = Field(
        default=True,
        description="Also register/refresh the orchestrator source (manifest + hub descriptor + src-index breadcrumb) so the satellite is discoverable via facet-descent.",
    )
    dry_run: bool = Field(
        default=False,
        description="Parse + normalise + count only; write nothing. Use to preview size before importing.",
    )
    vectorize_detail: bool = Field(
        default=False,
        description="Override SA-3: also embed T3/T4 detail nodes (functions, basic blocks). Default False — only T1/T2 summary nodes are vectorised; detail stays in the graph, reached by traverse.",
    )
    exclude_code_types: list[str] | None = Field(
        default=None,
        description="Node code_types to DROP entirely (from both graph and vector). Default None drops sub-function BasicBlocks — gitnexus emits ~286k for solace-buzz, pure noise for KH's tiers. Pass [] to keep everything.",
    )


# ── tier classification + no-stub vectorisation policy (SA-3) ────────────────
# Embedding 50k thin "label (type) file:line" stubs makes 50k near-duplicate
# vectors that crowd the top-k with same-named noise (the exact retrieval failure
# SA-3 calls out). So only SUMMARY nodes (T2 skeleton: files/modules/classes/
# communities) get a vector; per-function/basic-block DETAIL (T3/T4) stays in the
# graph and is reached by traversal. Everything is still written to the graph.

_SUMMARY_CODE_TYPES = frozenset({
    "module", "package", "file", "namespace", "folder", "directory",
    "class", "interface", "struct", "enum", "trait", "protocol",
    "service", "component", "community", "cluster", "god_node", "godnode",
    "schema", "table", "contract",
})
_DETAIL_CODE_TYPES = frozenset({
    "function", "method", "constructor", "closure", "lambda",
    "basicblock", "basic_block", "block", "statement", "expression",
    "variable", "parameter", "field", "property", "call",
})


# Dropped from BOTH graph and vector by default (B8): gitnexus emits a BasicBlock per
# sub-function control-flow block (~286k for solace-buzz) — below KH's finest tier (T4
# code) and pure bloat for blast-radius. Callers can override via exclude_code_types.
_DEFAULT_EXCLUDE_CODE_TYPES = frozenset({"basicblock", "basic_block"})


def _tier_of(code_type: str) -> str:
    """Coarse tier tag for a code node: T2 (skeleton/summary) vs T3 (detail)."""
    ct = (code_type or "").strip().lower()
    if ct in _SUMMARY_CODE_TYPES:
        return "T2"
    if ct in _DETAIL_CODE_TYPES:
        return "T3"
    return "T2"  # unknown → treat as summary so recall is never silently dropped


def _vectorizable(entity: dict, include_detail: bool) -> bool:
    """True if this node should get a vector (SA-3). Detail nodes skip unless overridden."""
    if include_detail:
        return True
    ct = (entity.get("attributes", {}).get("code_type") or "").strip().lower()
    return ct not in _DETAIL_CODE_TYPES


# ── normalisation: tool nodes/edges → KH entity/edge dicts ───────────────────

def _semantic_text(node: dict) -> str:
    """Text embedded for a code node so a mention can resolve to its core_id."""
    loc = f"{node['source_file']}:{node['source_location']}".strip(":")
    parts = [node["label"], f"({node['code_type']})" if node["code_type"] else "", loc]
    return " ".join(p for p in parts if p).strip()


def _to_entities_edges(source_id: str, nodes: list[dict], edges: list[dict], tool: str):
    prefix = f"{source_id}__"
    entities = []
    for n in nodes:
        entities.append({
            "core_id": f"{prefix}{n['id']}",
            "label": n["label"],
            "type": n["attr_type"],           # already a valid ATTR NodeType
            "attributes": {
                "code_type": n["code_type"],
                "source_file": n["source_file"],
                "source_location": n["source_location"],
                "tool": tool,
            },
            "source_text": _semantic_text(n),
            "document_id": None,
        })
    out_edges = []
    for e in edges:
        loc = f"{e.get('source_file', '')}:{e.get('source_location', '')}".strip(":")
        out_edges.append({
            "source_core_id": f"{prefix}{e['source']}",
            "relation": e["relation"],
            "target_core_id": f"{prefix}{e['target']}",
            "attributes": {"tool": tool},
            "source_text": loc,
            "confidence": e.get("confidence", 1.0),
        })
    return entities, out_edges


# ── contract loading (KH-contract file, NOT a tool's native format) ──────────

def _load_contract_file(path: str) -> dict:
    """Load a KH-CONTRACT json file: {"nodes":[...], "edges":[...]}.

    This is what a tool-side adapter writes (already converted). KH never parses a
    tool's native output — federated query + file-based import both read THIS shape.
    """
    import json
    if not os.path.isfile(path):
        raise HTTPException(400, f"contract file not found: {path}")
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception as exc:
        raise HTTPException(400, f"contract file is not valid json: {exc}") from exc
    if not isinstance(data, dict) or "nodes" not in data:
        raise HTTPException(400, "contract file must be an object with a 'nodes' array")
    data.setdefault("edges", [])
    return data


# ── source registration (mirrors /source/register breadcrumb) ────────────────

async def _register_source(source_id: str, tool: str, n_nodes: int,
                           conflicts_with: list[str], model) -> None:
    """Best-effort: register the source in the orchestrator manifest + drop a
    src-index breadcrumb so a flat query can discover the satellite. Failure here
    must not fail the import."""
    import asyncio
    from app import orchestrator as orch

    descriptor = (
        f"Code-graph index for '{source_id}' imported from {tool} into KH "
        f"(per-source collection + prefixed Kùzu graph, {n_nodes} nodes). "
        f"Query native via /orchestrator/graph_read|graph_traverse -Session {source_id}."
    )
    try:
        emb = await asyncio.to_thread(model.encode, descriptor, normalize_embeddings=True)
        await asyncio.to_thread(vs.upsert_hub_descriptor, source_id, emb.tolist(), descriptor)
        breadcrumb = (
            f"KNOWLEDGE topic:src-index source:{source_id} - Nguon '{source_id}' nam trong SATELLITE "
            f"cua orchestrator (collection rieng), KHONG o kho phang nen flat query se MISS. "
            f"Descriptor: {descriptor} DE LAY DATA route qua /orchestrator/ask -Session {source_id}."
        )
        bemb = await asyncio.to_thread(model.encode, breadcrumb, normalize_embeddings=True)
        await asyncio.to_thread(
            vs.upsert_vt, f"srcidx__{source_id}", bemb.tolist(), breadcrumb,
            {"scope": "knowledge", "topic": "src-index", "knowledge_type": "quick"},
        )
        with orch._manifest_lock:
            man = orch._load()
            entry = man.setdefault("sources", {}).setdefault(source_id, {"source_id": source_id})
            entry.update({"owner": "codegraph", "descriptor": descriptor})
            # merge (never drop) conflicts_with so same-named forks stay separated
            merged = set(entry.get("conflicts_with", [])) | set(conflicts_with or [])
            entry["conflicts_with"] = sorted(merged)
            orch._save(man)
    except Exception:
        logger.exception("/codegraph/import — source registration failed for %s", source_id)


# ── route ────────────────────────────────────────────────────────────────────

def attach(app) -> None:
    TAG = ["Codegraph · import"]

    @app.post("/codegraph/federated", tags=TAG,
              summary="DEFER-IMPORT default: query a KH-CONTRACT file directly (no import into KH)")
    async def codegraph_federated(body: dict):
        """Query a KH-CONTRACT file (written by a tool-side adapter) for nodes matching
        a term — WITHOUT materialising anything into KH. This is the DEFER-IMPORT default
        (fen): tool adapters convert their output to the KH contract; KH reads THAT, never
        the tool's native format. Pass `contract_path` (a {nodes,edges} json) or inline `nodes`."""
        term = (body.get("term") or "").strip().lower()
        limit = int(body.get("limit", 25))
        contract_path = (body.get("contract_path") or body.get("path") or "").strip()
        nodes = body.get("nodes")
        edges = body.get("edges") or []
        if nodes is None:
            if not contract_path:
                raise HTTPException(400, "contract_path or inline nodes required")
            data = _load_contract_file(contract_path)
            nodes, edges = data["nodes"], data.get("edges", [])
        hits = []
        for n in nodes:
            if not term or term in (n.get("label", "") or "").lower():
                loc = f"{n.get('source_file','')}:{n.get('source_location','')}".strip(":")
                hits.append({"id": n.get("id"), "label": n.get("label"),
                             "code_type": n.get("code_type", ""), "location": loc})
                if len(hits) >= limit:
                    break
        return {"tool": body.get("tool", ""), "federated": True, "total_nodes": len(nodes),
                "total_edges": len(edges), "term": term, "matches": hits}

    @app.post("/codegraph/import", tags=TAG,
              summary="Bulk-import a code-graph in the FIXED KH CONTRACT (tool-agnostic) → per-project vectors + Kùzu graph")
    async def codegraph_import(body: CodegraphImportRequest, request: Request):
        import asyncio

        # tool is METADATA ONLY (provenance) — KH does not branch on it. Tool-native
        # parsing lives in the tool-side adapters (tools/adapters/*), which have already
        # converted to the contract carried in body.nodes / body.edges.
        tool = (body.tool or "").strip().lower()

        # B2 canonical identity: source_id IS the project — never a tool fragment.
        # A `graphify__X` / `gitnexus__X` id is rejected here so one repo can never
        # split into three source_ids; the tool is carried as metadata instead.
        try:
            project_id = assert_canonical_id(body.source_id)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

        nodes = [n.model_dump() for n in body.nodes]
        edges = [e.model_dump() for e in body.edges]
        if not nodes:
            raise HTTPException(400, "no nodes in the import contract (body.nodes is empty)")

        entities, out_edges = _to_entities_edges(project_id, nodes, edges, tool)

        # B8 tier filter: drop excluded code_types (default: sub-function BasicBlocks)
        # from BOTH graph and vector, and any edge that touches a dropped node.
        exclude = _DEFAULT_EXCLUDE_CODE_TYPES if body.exclude_code_types is None \
            else {c.strip().lower() for c in body.exclude_code_types}
        dropped_detail = 0
        if exclude:
            keep = {e["core_id"] for e in entities
                    if (e["attributes"].get("code_type") or "").strip().lower() not in exclude}
            dropped_detail = len(entities) - len(keep)
            if dropped_detail:
                entities = [e for e in entities if e["core_id"] in keep]
                out_edges = [ed for ed in out_edges
                             if ed["source_core_id"] in keep and ed["target_core_id"] in keep]

        if body.dry_run:
            would_vec = sum(1 for e in entities if _vectorizable(e, body.vectorize_detail))
            return {
                "status": "dry_run", "source_id": project_id, "tool": tool,
                "nodes": len(entities), "edges": len(out_edges),
                "excluded_nodes": dropped_detail,
                "would_vectorize": would_vec, "detail_skipped": len(entities) - would_vec,
            }

        if not entities:
            raise HTTPException(400, "no nodes parsed from the tool output")

        model = request.app.state.model

        # SA-3 no-stub: embed only SUMMARY (T2) nodes; per-function/basic-block detail
        # goes to the graph only. ALL nodes are still written to the graph below.
        vec_entities = [e for e in entities if _vectorizable(e, body.vectorize_detail)]
        skipped = len(entities) - len(vec_entities)

        # 1) embed (batched) + 2) per-source vectors + 3) per-project graph
        try:
            vectors = await asyncio.to_thread(embed_entities, vec_entities, model)
        except Exception as exc:
            logger.exception("/codegraph/import — embedding failed")
            raise HTTPException(500, f"Embedding error: {exc}") from exc

        emap = {e["core_id"]: e for e in entities}

        def _persist() -> None:
            # scope + topic + tier tags keep this import a distinct record class inside
            # the source's own collection: a query can filter where={"topic":...} so
            # code-graph nodes never crowd or collide with other topics. Source code is
            # tagged by TIER (T1–T4); knowledge is tagged by C4 (handled in /layers).
            batch = []
            for core_id, vector in vectors:
                e = emap[core_id]
                code_type = e["attributes"].get("code_type", "")
                batch.append({
                    "core_id": core_id, "vector": vector,
                    "source_text": e.get("source_text", ""),
                    "metadata": {"scope": "codegraph", "topic": body.topic,
                                 "type": e.get("type", ""),
                                 "code_type": code_type,
                                 "tier": _tier_of(code_type),
                                 "tool": tool},
                })
            # batched Chroma + set-based Kùzu = minutes -> seconds at 50k+ nodes.
            # B3: nodes/edges land in the PROJECT's OWN Kùzu db (kuzu_data/<project>/),
            # so a later traversal physically cannot reach another project's graph.
            g = get_project_graph(project_id)
            vs.upsert_src_batch(project_id, batch)
            g.upsert_nodes_bulk(entities)
            g.upsert_edges_bulk(out_edges)

        try:
            await asyncio.to_thread(_persist)
        except Exception as exc:
            logger.exception("/codegraph/import — persistence failed")
            raise HTTPException(500, f"Graph/vector DB error: {exc}") from exc

        # B2: record the canonical PROJECT bundle (idempotent) — the tool is merged
        # into project.tools, so one project accumulates every tool that scanned it
        # instead of fragmenting into per-tool source_ids.
        try:
            kh_projects.get_or_create_project(
                project_id, tools=[tool], conflicts_with=body.conflicts_with)
        except Exception:
            logger.exception("/codegraph/import — project bundle registration failed for %s", project_id)

        if body.register_source:
            await _register_source(project_id, tool, len(entities),
                                   body.conflicts_with, model)

        logger.info(
            "/codegraph/import — source=%s tool=%s nodes=%d edges=%d vectors=%d detail_skipped=%d",
            project_id, tool, len(entities), len(out_edges), len(vectors), skipped,
        )
        return {
            "status": "ok", "source_id": project_id, "tool": tool,
            "nodes_imported": len(entities), "edges_imported": len(out_edges),
            "excluded_nodes": dropped_detail,
            "vectors": len(vectors), "detail_skipped": skipped,
            "registered": body.register_source,
        }
