-- Migration V2: align schema with State-based Conditional Logic approach
-- Run ONCE on existing installations. Safe to skip for fresh installs
-- (bootstrap_db in db.py already creates the new schema).
--
-- Changes:
--   KH_GRAPH_NODES.ORIGINAL_TEXT  →  LABEL       (the human-readable node name from LLM)
--   KH_GRAPH_NODES.CONTEXT        →  SOURCE_TEXT  (original /add_knowledge input text)

-- Step 1: add new columns
ALTER TABLE "KNOWLEDGE_HUB"."KH_GRAPH_NODES" ADD ("LABEL" NVARCHAR(500));
ALTER TABLE "KNOWLEDGE_HUB"."KH_GRAPH_NODES" ADD ("SOURCE_TEXT" NCLOB);

-- Step 2: migrate existing data
--   ORIGINAL_TEXT → LABEL  (copy values; data is valid, just misnamed)
--   CONTEXT → SOURCE_TEXT  (was always empty, nothing to copy)
UPDATE "KNOWLEDGE_HUB"."KH_GRAPH_NODES" SET "LABEL" = "ORIGINAL_TEXT";

COMMIT;

-- Step 3: drop obsolete columns
ALTER TABLE "KNOWLEDGE_HUB"."KH_GRAPH_NODES" DROP ("ORIGINAL_TEXT");
ALTER TABLE "KNOWLEDGE_HUB"."KH_GRAPH_NODES" DROP ("CONTEXT");

COMMIT;
