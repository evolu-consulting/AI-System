"""
Migration V5: add per-node SOURCE_TEXT column to KH_GRAPH_NODES.

Previously, source_text was fetched by joining KH_DOCUMENTS via DOCUMENT_ID,
which caused every node from the same document to return the full input text —
duplicated and wasteful when responses contain many nodes.

After this migration each node stores only its own relevant text snippet.
New ingestions compute the snippet automatically; existing rows are back-filled
with the full document text as a baseline (better than empty).

Safe to run multiple times — each step is guarded by an existence check.

Supports both backends:
  • SAP HANA  — ALTER TABLE ADD COLUMN (native DDL) + UPDATE from JOIN
  • Kùzu      — ALTER TABLE ADD COLUMN (supported since Kùzu 0.4) + MATCH SET

Run:
  python run_migration_v5.py            # migrates whichever backend is active
  python run_migration_v5.py --hana     # force HANA only
  python run_migration_v5.py --kuzu     # force Kùzu only
"""

import os
import sys
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

NOW_ISO = datetime.now(timezone.utc).isoformat()


# =============================================================================
# SAP HANA migration
# =============================================================================

def _hana_col_exists(cur, table: str, col: str) -> bool:
    cur.execute(
        "SELECT COUNT(*) FROM SYS.TABLE_COLUMNS "
        "WHERE SCHEMA_NAME = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?",
        [
            os.getenv("HANA_SCHEMA", "KNOWLEDGE_HUB").upper(),
            table.upper(),
            col.upper(),
        ],
    )
    return cur.fetchone()[0] > 0


def migrate_hana() -> None:
    print("\n── SAP HANA migration ──────────────────────────────────────")
    try:
        from hdbcli import dbapi
    except ImportError:
        print("  SKIP: hdbcli not installed")
        return

    schema   = os.getenv("HANA_SCHEMA", "KNOWLEDGE_HUB")
    host     = os.getenv("HANA_HOST", "localhost")
    port     = int(os.getenv("HANA_PORT", "39041"))
    user     = os.getenv("HANA_USERNAME", "SYSTEM")
    password = os.getenv("HANA_PASSWORD", "")
    encrypt  = os.getenv("HANA_ENCRYPT", "false").strip('"').lower() == "true"

    try:
        conn = dbapi.connect(
            address=host, port=port, user=user,
            password=password, encrypt=encrypt, autocommit=False,
        )
    except Exception as exc:
        print(f"  SKIP: cannot connect to HANA — {exc}")
        return

    cur = conn.cursor()
    try:
        if not _hana_col_exists(cur, "KH_GRAPH_NODES", "SOURCE_TEXT"):
            print("  Adding SOURCE_TEXT to KH_GRAPH_NODES ...")
            cur.execute(
                f'ALTER TABLE "{schema}"."KH_GRAPH_NODES" ADD ("SOURCE_TEXT" NCLOB)'
            )
            # Back-fill: populate from the joined document text as a baseline.
            cur.execute(
                f'UPDATE "{schema}"."KH_GRAPH_NODES" n '
                f'SET n."SOURCE_TEXT" = ('
                f'  SELECT d."SOURCE_TEXT" FROM "{schema}"."KH_DOCUMENTS" d '
                f'  WHERE d."ID" = n."DOCUMENT_ID"'
                f') '
                f'WHERE n."SOURCE_TEXT" IS NULL OR n."SOURCE_TEXT" = \'\''
            )
            conn.commit()
            print("  ✓ SOURCE_TEXT added to KH_GRAPH_NODES (back-filled from KH_DOCUMENTS)")
        else:
            print("  KH_GRAPH_NODES.SOURCE_TEXT already exists — skip")

        print("  SAP HANA migration V5 complete.")

    except Exception as exc:
        conn.rollback()
        print(f"  ERROR: {exc}")
        raise
    finally:
        cur.close()
        conn.close()


# =============================================================================
# Kùzu migration
# =============================================================================

def _kuzu_col_exists(conn, table: str, col: str) -> bool:
    try:
        result = conn.execute(f"CALL table_info('{table}') RETURN *")
        while result.has_next():
            row = result.get_next()
            for cell in row:
                if isinstance(cell, str) and cell.lower() == col.lower():
                    return True
        return False
    except Exception:
        try:
            conn.execute(f"MATCH (n:{table}) RETURN n.{col} LIMIT 0")
            return True
        except Exception:
            return False


def migrate_kuzu() -> None:
    print("\n── Kùzu migration ──────────────────────────────────────────")
    try:
        import kuzu
    except ImportError:
        print("  SKIP: kuzu not installed")
        return

    kuzu_path = os.getenv("KUZU_PATH", "./kuzu_data")
    try:
        db   = kuzu.Database(kuzu_path)
        conn = kuzu.Connection(db)
    except Exception as exc:
        print(f"  SKIP: cannot open Kùzu at '{kuzu_path}' — {exc}")
        return

    try:
        if not _kuzu_col_exists(conn, "KH_GRAPH_NODES", "source_text"):
            print("  Adding source_text to KH_GRAPH_NODES ...")
            conn.execute("ALTER TABLE KH_GRAPH_NODES ADD source_text STRING DEFAULT ''")
            # Back-fill: join each node's document to get the full text as a baseline.
            # Kùzu doesn't support correlated subqueries in SET, so we do a MATCH join.
            conn.execute(
                "MATCH (n:KH_GRAPH_NODES), (d:KH_DOCUMENTS) "
                "WHERE d.id = n.document_id "
                "  AND (n.source_text = '' OR n.source_text IS NULL) "
                "SET n.source_text = d.source_text"
            )
            print("  ✓ source_text added to KH_GRAPH_NODES (back-filled from KH_DOCUMENTS)")
        else:
            print("  KH_GRAPH_NODES.source_text already exists — skip")

        print("  Kùzu migration V5 complete.")

    except Exception as exc:
        print(f"  ERROR: {exc}")
        raise


# =============================================================================
# Entry point
# =============================================================================

def main() -> None:
    args = sys.argv[1:]
    run_hana = "--hana" in args or not args
    run_kuzu = "--kuzu" in args or not args

    print("=== Migration V5: adding per-node SOURCE_TEXT column ===")
    print(f"    Run time: {NOW_ISO}")

    if run_hana:
        migrate_hana()
    if run_kuzu:
        migrate_kuzu()

    print("\n=== Migration V5 finished ===")


if __name__ == "__main__":
    main()
