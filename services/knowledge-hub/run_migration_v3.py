"""
Migration V3: normalise source text out of KH_GRAPH_NODES into KH_DOCUMENTS.

Steps:
  1. Create KH_DOCUMENTS (if not already present)
  2. Add DOCUMENT_ID column to KH_GRAPH_NODES (if absent)
  3. Migrate existing SOURCE_TEXT values -> KH_DOCUMENTS rows, set DOCUMENT_ID
  4. Drop SOURCE_TEXT from KH_GRAPH_NODES

Safe to run multiple times.
"""
import hashlib
import os
from dotenv import load_dotenv

load_dotenv()

HANA_HOST     = os.getenv("HANA_HOST",     "localhost")
HANA_PORT     = int(os.getenv("HANA_PORT", "39041"))
HANA_USER     = os.getenv("HANA_USERNAME", "SYSTEM")
HANA_PASSWORD = os.getenv("HANA_PASSWORD", "")
HANA_SCHEMA   = os.getenv("HANA_SCHEMA",   "KNOWLEDGE_HUB")
HANA_ENCRYPT  = os.getenv("HANA_ENCRYPT",  "false").strip('"').lower() == "true"


def col_exists(cur, table: str, col: str) -> bool:
    cur.execute(
        "SELECT COUNT(*) FROM SYS.TABLE_COLUMNS "
        "WHERE SCHEMA_NAME=? AND TABLE_NAME=? AND COLUMN_NAME=?",
        [HANA_SCHEMA.upper(), table.upper(), col.upper()],
    )
    return cur.fetchone()[0] > 0


def table_exists(cur, table: str) -> bool:
    cur.execute(
        "SELECT COUNT(*) FROM SYS.TABLES WHERE SCHEMA_NAME=? AND TABLE_NAME=?",
        [HANA_SCHEMA.upper(), table.upper()],
    )
    return cur.fetchone()[0] > 0


def run():
    from hdbcli import dbapi
    conn = dbapi.connect(
        address=HANA_HOST, port=HANA_PORT,
        user=HANA_USER, password=HANA_PASSWORD,
        encrypt=HANA_ENCRYPT, autocommit=False,
    )
    cur = conn.cursor()

    try:
        # ── Step 1: create KH_DOCUMENTS ─────────────────────────────────────
        if not table_exists(cur, "KH_DOCUMENTS"):
            print("Creating KH_DOCUMENTS...")
            cur.execute(f"""
                CREATE COLUMN TABLE "{HANA_SCHEMA}"."KH_DOCUMENTS" (
                    "ID"          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    "CHECKSUM"    NVARCHAR(64) NOT NULL,
                    "SOURCE_TEXT" NCLOB NOT NULL,
                    "CREATED_AT"  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE ("CHECKSUM")
                )
            """)
            conn.commit()
            print("  KH_DOCUMENTS created")
        else:
            print("  KH_DOCUMENTS already exists - skip create")

        # ── Step 2: add DOCUMENT_ID to KH_GRAPH_NODES ───────────────────────
        if not col_exists(cur, "KH_GRAPH_NODES", "DOCUMENT_ID"):
            print("Adding DOCUMENT_ID column to KH_GRAPH_NODES...")
            cur.execute(
                f'ALTER TABLE "{HANA_SCHEMA}"."KH_GRAPH_NODES" ADD ("DOCUMENT_ID" BIGINT)'
            )
            conn.commit()
            print("  DOCUMENT_ID added")
        else:
            print("  DOCUMENT_ID already exists - skip")

        # ── Step 3: migrate existing SOURCE_TEXT -> KH_DOCUMENTS ────────────
        if col_exists(cur, "KH_GRAPH_NODES", "SOURCE_TEXT"):
            print("Migrating SOURCE_TEXT values into KH_DOCUMENTS...")

            # Fetch all non-empty source texts
            # HANA: NCLOB can't use DISTINCT or != comparison — use LENGTH() guard
            cur.execute(
                f'SELECT "SOURCE_TEXT" FROM "{HANA_SCHEMA}"."KH_GRAPH_NODES" '
                f'WHERE "SOURCE_TEXT" IS NOT NULL AND LENGTH("SOURCE_TEXT") > 0'
            )
            # Deduplicate by checksum in Python
            seen_checksums: set[str] = set()
            source_texts: list[str] = []
            for (src,) in cur.fetchall():
                chk = hashlib.sha256(src.encode("utf-8")).hexdigest()
                if chk not in seen_checksums:
                    seen_checksums.add(chk)
                    source_texts.append(src)
            print(f"  Found {len(source_texts)} distinct source text(s) to migrate")

            checksum_to_id: dict[str, int] = {}
            for src in source_texts:
                checksum = hashlib.sha256(src.encode("utf-8")).hexdigest()
                # Insert if not present
                cur.execute(
                    f'INSERT INTO "{HANA_SCHEMA}"."KH_DOCUMENTS" ("SOURCE_TEXT", "CHECKSUM")'
                    f' SELECT ?, ? FROM DUMMY'
                    f' WHERE NOT EXISTS ('
                    f'   SELECT 1 FROM "{HANA_SCHEMA}"."KH_DOCUMENTS" WHERE "CHECKSUM" = ?'
                    f')',
                    [src, checksum, checksum],
                )
                # Get the ID
                cur.execute(
                    f'SELECT "ID" FROM "{HANA_SCHEMA}"."KH_DOCUMENTS" WHERE "CHECKSUM" = ?',
                    [checksum],
                )
                row = cur.fetchone()
                if row:
                    checksum_to_id[checksum] = row[0]
            conn.commit()
            print(f"  Inserted/found {len(checksum_to_id)} document(s) in KH_DOCUMENTS")

            # Fetch (CORE_ID, SOURCE_TEXT) for all nodes that need DOCUMENT_ID set
            # Match is done in Python to avoid HANA NCLOB comparison restrictions
            cur.execute(
                f'SELECT "CORE_ID", "SOURCE_TEXT" FROM "{HANA_SCHEMA}"."KH_GRAPH_NODES" '
                f'WHERE "DOCUMENT_ID" IS NULL AND LENGTH("SOURCE_TEXT") > 0'
            )
            node_rows = cur.fetchall()
            print(f"  Updating {len(node_rows)} node(s) with DOCUMENT_ID...")

            updated = 0
            for core_id, src in node_rows:
                checksum = hashlib.sha256(src.encode("utf-8")).hexdigest()
                doc_id = checksum_to_id.get(checksum)
                if doc_id is None:
                    continue
                # Update by CORE_ID (NVARCHAR — safe for WHERE equality)
                cur.execute(
                    f'UPDATE "{HANA_SCHEMA}"."KH_GRAPH_NODES" '
                    f'SET "DOCUMENT_ID" = ? WHERE "CORE_ID" = ?',
                    [doc_id, core_id],
                )
                updated += cur.rowcount
            conn.commit()
            print(f"  Updated {updated} node(s) with DOCUMENT_ID")

            # ── Step 4: drop SOURCE_TEXT ─────────────────────────────────────
            print("Dropping SOURCE_TEXT from KH_GRAPH_NODES...")
            cur.execute(
                f'ALTER TABLE "{HANA_SCHEMA}"."KH_GRAPH_NODES" DROP ("SOURCE_TEXT")'
            )
            conn.commit()
            print("  SOURCE_TEXT dropped")
        else:
            print("  SOURCE_TEXT not present - migration already applied or fresh install")

        print("\nMigration V3 complete.")

    except Exception as exc:
        conn.rollback()
        print(f"ERROR: {exc}")
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    run()
