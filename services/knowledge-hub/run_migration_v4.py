"""
Migration V4: add CREATED_AT timestamp columns for conflict-resolution support.

Changes applied:
  KH_GRAPH_NODES  ← ADD CREATED_AT  (when a concept was first ingested)
  KH_GRAPH_EDGES  ← ADD CREATED_AT  (when a relationship was first established)

Existing rows receive the current timestamp as a baseline.
Safe to run multiple times — each step is guarded by an existence check.

Supports both backends:
  • SAP HANA  — ALTER TABLE ADD COLUMN (native DDL)
  • Kùzu      — ALTER TABLE ADD COLUMN (supported since Kùzu 0.4)

Run:
  python run_migration_v4.py            # migrates whichever backend is active
  python run_migration_v4.py --hana     # force HANA only
  python run_migration_v4.py --kuzu     # force Kùzu only
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
        # ── KH_GRAPH_NODES.CREATED_AT ────────────────────────────────────────
        if not _hana_col_exists(cur, "KH_GRAPH_NODES", "CREATED_AT"):
            print("  Adding CREATED_AT to KH_GRAPH_NODES ...")
            cur.execute(
                f'ALTER TABLE "{schema}"."KH_GRAPH_NODES" '
                f'ADD ("CREATED_AT" TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'
            )
            # Back-fill existing rows with current timestamp as baseline
            cur.execute(
                f'UPDATE "{schema}"."KH_GRAPH_NODES" '
                f'SET "CREATED_AT" = CURRENT_TIMESTAMP WHERE "CREATED_AT" IS NULL'
            )
            conn.commit()
            print("  ✓ CREATED_AT added to KH_GRAPH_NODES")
        else:
            print("  KH_GRAPH_NODES.CREATED_AT already exists — skip")

        # ── KH_GRAPH_EDGES.CREATED_AT ─────────────────────────────────────────
        if not _hana_col_exists(cur, "KH_GRAPH_EDGES", "CREATED_AT"):
            print("  Adding CREATED_AT to KH_GRAPH_EDGES ...")
            cur.execute(
                f'ALTER TABLE "{schema}"."KH_GRAPH_EDGES" '
                f'ADD ("CREATED_AT" TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'
            )
            cur.execute(
                f'UPDATE "{schema}"."KH_GRAPH_EDGES" '
                f'SET "CREATED_AT" = CURRENT_TIMESTAMP WHERE "CREATED_AT" IS NULL'
            )
            conn.commit()
            print("  ✓ CREATED_AT added to KH_GRAPH_EDGES")
        else:
            print("  KH_GRAPH_EDGES.CREATED_AT already exists — skip")

        print("  SAP HANA migration V4 complete.")

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
    """Check if a column exists by inspecting the table schema via CALL table_info."""
    try:
        result = conn.execute(f"CALL table_info('{table}') RETURN *")
        while result.has_next():
            row = result.get_next()
            # row layout varies by Kùzu version; column name is usually in index 1 or 2
            for cell in row:
                if isinstance(cell, str) and cell.lower() == col.lower():
                    return True
        return False
    except Exception:
        # If table_info is unavailable, try a probe query instead
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
        # ── KH_GRAPH_NODES.created_at ────────────────────────────────────────
        if not _kuzu_col_exists(conn, "KH_GRAPH_NODES", "created_at"):
            print("  Adding created_at to KH_GRAPH_NODES ...")
            conn.execute("ALTER TABLE KH_GRAPH_NODES ADD created_at STRING DEFAULT ''")
            # Back-fill: set baseline timestamp for all existing rows
            conn.execute(
                "MATCH (n:KH_GRAPH_NODES) WHERE n.created_at = '' OR n.created_at IS NULL "
                "SET n.created_at = $ts",
                {"ts": NOW_ISO},
            )
            print("  ✓ created_at added to KH_GRAPH_NODES")
        else:
            print("  KH_GRAPH_NODES.created_at already exists — skip")

        # ── KH_GRAPH_EDGES.created_at ─────────────────────────────────────────
        if not _kuzu_col_exists(conn, "KH_GRAPH_EDGES", "created_at"):
            print("  Adding created_at to KH_GRAPH_EDGES ...")
            conn.execute("ALTER TABLE KH_GRAPH_EDGES ADD created_at STRING DEFAULT ''")
            conn.execute(
                "MATCH ()-[r:KH_GRAPH_EDGES]->() WHERE r.created_at = '' OR r.created_at IS NULL "
                "SET r.created_at = $ts",
                {"ts": NOW_ISO},
            )
            print("  ✓ created_at added to KH_GRAPH_EDGES")
        else:
            print("  KH_GRAPH_EDGES.created_at already exists — skip")

        print("  Kùzu migration V4 complete.")

    except Exception as exc:
        print(f"  ERROR: {exc}")
        raise


# =============================================================================
# Entry point
# =============================================================================

def main() -> None:
    args = sys.argv[1:]
    run_hana  = "--hana"  in args or not args
    run_kuzu  = "--kuzu"  in args or not args

    print("=== Migration V4: adding CREATED_AT timestamps ===")
    print(f"    Baseline timestamp for existing rows: {NOW_ISO}")

    if run_hana:
        migrate_hana()
    if run_kuzu:
        migrate_kuzu()

    print("\n=== Migration V4 finished ===")


if __name__ == "__main__":
    main()
