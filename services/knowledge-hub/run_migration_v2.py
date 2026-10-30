"""
Migration V2 runner — run once to rename ORIGINAL_TEXT->LABEL, CONTEXT->SOURCE_TEXT.
Safe to run multiple times: checks column state before applying each step.
"""
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


def run():
    from hdbcli import dbapi
    conn = dbapi.connect(
        address=HANA_HOST, port=HANA_PORT,
        user=HANA_USER, password=HANA_PASSWORD,
        encrypt=HANA_ENCRYPT, autocommit=False,
    )
    cur = conn.cursor()

    try:
        tbl = "KH_GRAPH_NODES"

        has_original = col_exists(cur, tbl, "ORIGINAL_TEXT")
        has_label    = col_exists(cur, tbl, "LABEL")
        has_context  = col_exists(cur, tbl, "CONTEXT")
        has_source   = col_exists(cur, tbl, "SOURCE_TEXT")

        print(f"Current columns: ORIGINAL_TEXT={has_original} LABEL={has_label} CONTEXT={has_context} SOURCE_TEXT={has_source}")

        # Step 1: add LABEL if missing
        if not has_label:
            print("Adding LABEL column...")
            cur.execute(f'ALTER TABLE "{HANA_SCHEMA}"."{tbl}" ADD ("LABEL" NVARCHAR(500))')
            conn.commit()
            has_label = True

        # Step 2: copy ORIGINAL_TEXT -> LABEL if both exist (handles partial migration)
        if has_original and has_label:
            print("Copying ORIGINAL_TEXT -> LABEL...")
            cur.execute(f'UPDATE "{HANA_SCHEMA}"."{tbl}" SET "LABEL" = "ORIGINAL_TEXT" WHERE "LABEL" IS NULL OR "LABEL" = \'\'')
            conn.commit()
            print("Dropping ORIGINAL_TEXT...")
            cur.execute(f'ALTER TABLE "{HANA_SCHEMA}"."{tbl}" DROP ("ORIGINAL_TEXT")')
            conn.commit()
            print("  LABEL done")
        elif has_label and not has_original:
            print("  LABEL already migrated - skip")

        # Step 3: add SOURCE_TEXT if missing
        if not has_source:
            print("Adding SOURCE_TEXT column...")
            cur.execute(f'ALTER TABLE "{HANA_SCHEMA}"."{tbl}" ADD ("SOURCE_TEXT" NCLOB)')
            conn.commit()
            has_source = True

        # Step 4: drop CONTEXT if still present
        if has_context:
            print("Dropping CONTEXT...")
            cur.execute(f'ALTER TABLE "{HANA_SCHEMA}"."{tbl}" DROP ("CONTEXT")')
            conn.commit()
            print("  SOURCE_TEXT done")
        elif has_source and not has_context:
            print("  SOURCE_TEXT already migrated - skip")

        print("Migration complete.")

    except Exception as exc:
        conn.rollback()
        print(f"ERROR: {exc}")
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    run()
