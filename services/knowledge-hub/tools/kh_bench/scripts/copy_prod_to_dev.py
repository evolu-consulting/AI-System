"""Copy KH data from the prod HANA schema (kh-hana-v2) into the dev schema (kh-sso-hana).

Why at the database level: rows keep their ids, embeddings, metadata.author and ts exactly, and
4,000+ rows copy in minutes instead of hours of re-embedding through the API.

What happens on dev (Rowan 2026-10-01: dev holds test data only, no backup, clear and import fresh):
  * KEEP (they are what a bench measures): HOOK_RULES, POLICY_ACTIONS, POLICY_RULES.
  * CLEAR, not copied (people's mail, delivery state): MESSAGE_STACK, MESSAGE_ARCHIVE.
  * DROP every other dev table that prod does not have (old test projects, their graphs).
  * REPLACE every other table with prod's rows: vectors, graphs, project registry, KH_DOCS.
Grants and people live in Keycloak, which prod and dev share, so nothing there needs copying.

Credentials: service-key JSON (cf service-key <service> kh-bench-copy) saved as
  <KH_BENCH_SECRETS>/hana-prod-bench.json   (service kh-hana-v2)
  <KH_BENCH_SECRETS>/hana-dev-bench.json    (service kh-sso-hana)

Usage:
  python copy_prod_to_dev.py plan [--with-policy]   dry run: tables, row counts, what would happen
  python copy_prod_to_dev.py run  [--with-policy]   clear dev, copy, verify counts
--with-policy (2026-10-02) also replaces dev's POLICY_ACTIONS and POLICY_RULES with prod's, so both sides
route actions the same way and /policy/plan behaviour can be compared; HOOK_RULES stay dev's. Use it unless
the feature under test IS a policy change.
After run: cf restart kh-sso (the app caches the registry and open graphs).
"""
import json, sys
import os
from pathlib import Path

from hdbcli import dbapi

SECRETS = Path(os.environ.get("KH_BENCH_SECRETS", Path.home() / ".claude_rowan" / "secrets"))
KEEP_ON_DEV = {"HOOK_RULES", "POLICY_ACTIONS", "POLICY_RULES"}
POLICY_TABLES = {"POLICY_ACTIONS", "POLICY_RULES"}
CLEAR_ON_DEV = {"MESSAGE_STACK", "MESSAGE_ARCHIVE"}
BATCH = 500


def connect(name):
    c = json.loads((SECRETS / f"hana-{name}-bench.json").read_text(encoding="utf-8"))
    c = c.get("credentials", c)
    conn = dbapi.connect(address=c["host"], port=int(c["port"]), user=c["user"], password=c["password"],
                         encrypt=True, sslValidateCertificate=True, autocommit=False)
    return conn, c["schema"]


def tables(conn, schema):
    cur = conn.cursor()
    cur.execute("SELECT TABLE_NAME FROM SYS.TABLES WHERE SCHEMA_NAME = ? AND IS_TEMPORARY = 'FALSE'", (schema,))
    return sorted(r[0] for r in cur.fetchall())


def columns(conn, schema, table):
    cur = conn.cursor()
    cur.execute("SELECT COLUMN_NAME, DATA_TYPE_NAME, LENGTH, SCALE, IS_NULLABLE, DEFAULT_VALUE FROM SYS.TABLE_COLUMNS "
                "WHERE SCHEMA_NAME = ? AND TABLE_NAME = ? ORDER BY POSITION", (schema, table))
    return cur.fetchall()


def primary_key(conn, schema, table):
    cur = conn.cursor()
    cur.execute("SELECT COLUMN_NAME FROM SYS.CONSTRAINTS WHERE SCHEMA_NAME = ? AND TABLE_NAME = ? "
                "AND IS_PRIMARY_KEY = 'TRUE' ORDER BY POSITION", (schema, table))
    return [r[0] for r in cur.fetchall()]


def count(conn, schema, table):
    cur = conn.cursor()
    cur.execute(f'SELECT COUNT(*) FROM "{schema}"."{table}"')
    return cur.fetchone()[0]


def col_type(name, length, scale):
    if name in ("NVARCHAR", "VARCHAR", "VARBINARY", "ALPHANUM"):
        return f"{name}({length})"
    if name == "DECIMAL" and length:
        return f"DECIMAL({length},{scale or 0})"
    return name  # NCLOB, CLOB, BLOB, INTEGER, BIGINT, BOOLEAN, TIMESTAMP, DOUBLE, REAL_VECTOR, ...


def create_like(src, s_schema, dst, d_schema, table):
    defs = []
    for n, t, ln, sc, nullable, default in columns(src, s_schema, table):
        d = f'"{n}" {col_type(t, ln, sc)}'
        if default is not None:
            d += f" DEFAULT '{default}'" if t in ("NVARCHAR", "VARCHAR") else f" DEFAULT {default}"
        if nullable == "FALSE":
            d += " NOT NULL"
        defs.append(d)
    pk = primary_key(src, s_schema, table)
    if pk:
        defs.append("PRIMARY KEY (" + ", ".join(f'"{c}"' for c in pk) + ")")
    dst.cursor().execute(f'CREATE COLUMN TABLE "{d_schema}"."{table}" (' + ", ".join(defs) + ")")


def read_rows(conn, schema, table, cols):
    sel = ", ".join(f'TO_NVARCHAR("{n}")' if t == "REAL_VECTOR" else f'"{n}"' for n, t, *_ in cols)
    cur = conn.cursor()
    cur.execute(f'SELECT {sel} FROM "{schema}"."{table}"')
    while True:
        chunk = cur.fetchmany(BATCH)
        if not chunk:
            return
        yield [[v.read() if hasattr(v, "read") else v for v in row] for row in chunk]


def write_rows(conn, schema, table, cols, rows):
    marks = ", ".join("TO_REAL_VECTOR(?)" if t == "REAL_VECTOR" else "?" for n, t, *_ in cols)
    names = ", ".join(f'"{n}"' for n, *_ in cols)
    conn.cursor().executemany(f'INSERT INTO "{schema}"."{table}" ({names}) VALUES ({marks})', rows)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "plan"
    keep_on_dev = KEEP_ON_DEV - POLICY_TABLES if "--with-policy" in sys.argv[2:] else KEEP_ON_DEV
    prod, p_schema = connect("prod")
    dev, d_schema = connect("dev")
    p_tabs, d_tabs = set(tables(prod, p_schema)), set(tables(dev, d_schema))
    copy = sorted(t for t in p_tabs if t not in keep_on_dev and t not in CLEAR_ON_DEV)
    keep = sorted(d_tabs & keep_on_dev)
    clear = sorted(d_tabs & CLEAR_ON_DEV)
    drop = sorted(d_tabs - p_tabs - keep_on_dev - CLEAR_ON_DEV)

    print(f"prod schema {p_schema} -> dev schema {d_schema}")
    for t in copy:
        print(f"  REPLACE {t:58s} prod {count(prod, p_schema, t):>7}  dev "
              f"{count(dev, d_schema, t) if t in d_tabs else 'new':>7}")
    for t in keep:
        print(f"  KEEP    {t:58s} dev {count(dev, d_schema, t):>7} (dev's own, under test)")
    for t in clear:
        print(f"  CLEAR   {t:58s} dev {count(dev, d_schema, t):>7}")
    for t in drop:
        print(f"  DROP    {t:58s} dev {count(dev, d_schema, t):>7} (dev only)")
    if mode != "run":
        print("dry run only. Use: run")
        return

    # Both schemas live on the same HANA Cloud instance, so let HANA copy server-side (INSERT ... SELECT):
    # streaming 7,000 vector rows through this machine took over 30 minutes. The dev user may read the prod
    # schema ONLY for the length of this run; the grant is revoked in the finally block below.
    d_user = json.loads((SECRETS / "hana-dev-bench.json").read_text(encoding="utf-8"))
    d_user = d_user.get("credentials", d_user)["user"]
    prod.cursor().execute(f'GRANT SELECT ON SCHEMA "{p_schema}" TO "{d_user}"')
    prod.commit()
    try:
        return _run(prod, p_schema, dev, d_schema, copy, clear, drop, d_tabs)
    finally:
        prod.cursor().execute(f'REVOKE SELECT ON SCHEMA "{p_schema}" FROM "{d_user}"')
        prod.commit()
        print("revoked the dev user's read access to the prod schema")


def _run(prod, p_schema, dev, d_schema, copy, clear, drop, d_tabs):
    for t in drop:
        dev.cursor().execute(f'DROP TABLE "{d_schema}"."{t}"')
    for t in clear:
        dev.cursor().execute(f'DELETE FROM "{d_schema}"."{t}"')
    dev.commit()
    bad = []
    for t in copy:
        cols = columns(prod, p_schema, t)
        if t in d_tabs and [c[:2] for c in columns(dev, d_schema, t)] != [c[:2] for c in cols]:
            dev.cursor().execute(f'DROP TABLE "{d_schema}"."{t}"')  # shape differs: rebuild from prod
            d_tabs.discard(t)
        if t not in d_tabs:
            create_like(prod, p_schema, dev, d_schema, t)
        else:
            dev.cursor().execute(f'DELETE FROM "{d_schema}"."{t}"')
        names = ", ".join(f'"{c[0]}"' for c in cols)
        if count(prod, p_schema, t) == 0:  # nothing to copy (and identity columns refuse INSERT ... SELECT)
            dev.commit()
            print(f"copied {t}: prod 0 dev {count(dev, d_schema, t)}")
            continue
        dev.cursor().execute(f'INSERT INTO "{d_schema}"."{t}" ({names}) SELECT {names} FROM "{p_schema}"."{t}"')
        dev.commit()
        p, d = count(prod, p_schema, t), count(dev, d_schema, t)
        print(f"copied {t}: prod {p} dev {d}", "" if p == d else "MISMATCH")
        if p != d:
            bad.append(f"{t}: prod {p} dev {d}")
    print("PROBLEMS:\n  " + "\n  ".join(bad) if bad else "ALL TABLES MATCH")
    print("next: cf restart kh-sso")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main() or 0)
