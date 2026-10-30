-- SQLite schema of the SDLC line (line/line.db). Applied idempotently by line.store.SqliteStore.
-- Journal mode WAL is set by the store on open (not here: it is a per-database pragma).

-- Event log: gapless seq from 1 (assigned as MAX(seq)+1 inside BEGIN IMMEDIATE, never AUTOINCREMENT,
-- so a rolled-back write leaves no hole). synced = replicated to the RAG System event log.
CREATE TABLE IF NOT EXISTS event (
    seq           INTEGER PRIMARY KEY,
    kind          TEXT    NOT NULL,
    run           TEXT    NOT NULL,
    unit          TEXT    NOT NULL DEFAULT '',
    attempt       INTEGER NOT NULL DEFAULT 0,
    epoch         INTEGER NOT NULL DEFAULT 0,
    agent_version TEXT    NOT NULL DEFAULT '',
    model         TEXT    NOT NULL DEFAULT '',
    spec_hash     TEXT    NOT NULL DEFAULT '',
    body          TEXT    NOT NULL DEFAULT '{}',
    ts_ms         INTEGER NOT NULL DEFAULT 0,
    synced        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS event_run ON event(run, seq);
CREATE INDEX IF NOT EXISTS event_unsynced ON event(synced, seq);

-- Records: one table for every entity in contracts.ENTITIES (run, unit, spec_pack, f_item, digest,
-- acc_test, graph, attempt, gate_result, llm_call, merge_item, deploy_slot, qas_result, escalation).
-- row is the JSON dict (normally to_dict(<dataclass>)); version is the CAS counter (1 on create);
-- ord keeps insertion order for query().
CREATE TABLE IF NOT EXISTS record (
    entity   TEXT    NOT NULL,
    id       TEXT    NOT NULL,
    run      TEXT    NOT NULL DEFAULT '',
    version  INTEGER NOT NULL,
    ord      INTEGER NOT NULL,
    state    TEXT,                       -- copy of row.state (run/unit), for indexed lookups
    row      TEXT    NOT NULL,
    updated_ms INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (entity, id)
);
CREATE INDEX IF NOT EXISTS record_run ON record(entity, run, ord);
CREATE INDEX IF NOT EXISTS record_state ON record(entity, state);

-- Durable queue of RAG System writes made while degraded; replayed in id order with the same idem_key.
CREATE TABLE IF NOT EXISTS outbox (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    op         TEXT    NOT NULL,
    args       TEXT    NOT NULL,
    idem_key   TEXT    NOT NULL,
    created_ms INTEGER NOT NULL DEFAULT 0,
    tries      INTEGER NOT NULL DEFAULT 0
);

-- Named leases with fencing epochs (local authority). One row per name, kept forever so the
-- epoch is strictly increasing and never reused. state: live | released | reaped.
CREATE TABLE IF NOT EXISTS lease (
    name       TEXT    PRIMARY KEY,
    epoch      INTEGER NOT NULL,
    expires_ms INTEGER NOT NULL,
    owner      TEXT    NOT NULL DEFAULT '',
    state      TEXT    NOT NULL DEFAULT 'live',
    granted_ms INTEGER NOT NULL DEFAULT 0
);

-- Budget tree run -> F-item -> unit. node ids are unique within a run; the root node id = run id.
CREATE TABLE IF NOT EXISTS budget_node (
    run       TEXT NOT NULL,
    node      TEXT NOT NULL,
    parent    TEXT NOT NULL DEFAULT '',
    limit_usd REAL NOT NULL,
    spent     REAL NOT NULL DEFAULT 0,
    reserved  REAL NOT NULL DEFAULT 0,
    warned    INTEGER NOT NULL DEFAULT 0,   -- budget.warn already emitted for this node
    PRIMARY KEY (run, node)
);

CREATE TABLE IF NOT EXISTS budget_res (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    run  TEXT NOT NULL,
    node TEXT NOT NULL,
    usd  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '1');
