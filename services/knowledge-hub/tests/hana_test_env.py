"""Opt-in HANA run for the stage F tests (tests/caps/test_*.py, tests/test_stage_f1.py).

Default is unchanged: the tests force a throwaway SQLite database. They run on HANA only when BOTH
KH_TEST_HANA=1 and KH_STORE_BACKEND=hana are set, with HANA_HOST/PORT/USERNAME/PASSWORD and a
HANA_SCHEMA whose name contains TEST (e.g. KH_STAGEF_TEST). That schema is the HANA counterpart of the
throwaway file: it is wiped (graph workspaces, tables, views, sequences) when the test starts, so a
real schema can never be named here.
"""
import os


def store_backend() -> str:
    """'hana' when the opt-in is complete, otherwise 'sqlite' (the tests' default)."""
    if os.getenv("KH_TEST_HANA") == "1" and os.getenv("KH_STORE_BACKEND", "").strip().lower() == "hana":
        schema = os.getenv("HANA_SCHEMA", "")
        assert "TEST" in schema.upper(), "a HANA test run needs HANA_SCHEMA naming a TEST schema (it is wiped)"
        return "hana"
    return "sqlite"


def wipe_schema() -> None:
    """Drop every object of the (TEST) HANA_SCHEMA so the run starts empty; create the schema if missing."""
    from hdbcli import dbapi

    schema = os.environ["HANA_SCHEMA"].upper()
    assert "TEST" in schema
    conn = dbapi.connect(address=os.getenv("HANA_HOST", "localhost"), port=int(os.getenv("HANA_PORT", "39041")),
                         user=os.getenv("HANA_USERNAME", "SYSTEM"), password=os.getenv("HANA_PASSWORD", ""),
                         encrypt=os.getenv("HANA_ENCRYPT", "false").lower() == "true")
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM SYS.SCHEMAS WHERE SCHEMA_NAME=?", [schema])
        if not cur.fetchone()[0]:
            cur.execute(f'CREATE SCHEMA "{schema}"')
        for sql, kind in (("SELECT WORKSPACE_NAME FROM SYS.GRAPH_WORKSPACES WHERE SCHEMA_NAME=?", "GRAPH WORKSPACE"),
                          ("SELECT VIEW_NAME FROM SYS.VIEWS WHERE SCHEMA_NAME=?", "VIEW"),
                          ("SELECT TABLE_NAME FROM SYS.TABLES WHERE SCHEMA_NAME=?", "TABLE"),
                          ("SELECT SEQUENCE_NAME FROM SYS.SEQUENCES WHERE SCHEMA_NAME=?", "SEQUENCE")):
            cur.execute(sql, [schema])
            for (name,) in cur.fetchall():
                suffix = " CASCADE" if kind in ("TABLE", "VIEW") else ""
                cur.execute(f'DROP {kind} "{schema}"."{name}"{suffix}')
        conn.commit()
    finally:
        conn.close()
