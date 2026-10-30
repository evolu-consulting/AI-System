"""Create and seed the KH access-control tables (KH_AUTH_*) in the Keycloak PostgreSQL database.

PostgreSQL twin of seed.py (SAP HANA): same catalogue, same rules, same idempotence. Objects are created
when missing (views replaced), catalogue rows are upserted, and existing projects and grants are never
downgraded or removed. Run it after Keycloak's first start: the KH_AUTH_USER view reads its user tables.

The whole run is one psql transaction (schema_postgres.sql + the catalogue rows), so a failure changes nothing.

Usage:
    python seed_postgres.py --db-file <db.json> --psql <psql.exe> --maintainer <email> [--project <id> ...]

--db-file     JSON with host, port, database, user, password (and optional schema, default public).
--psql        The psql client of the PostgreSQL install.
--maintainer  Recorded as the owner of every seeded non-system project.
--project     A KH project to register besides the system projects; may be repeated.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TABLES = ("KH_AUTH_ROLE", "KH_AUTH_PROJECT_LEVEL", "KH_AUTH_PERMISSION", "KH_AUTH_ROLE_PERMISSION",
          "KH_AUTH_LEVEL_PERMISSION", "KH_AUTH_VISIBILITY_ACCESS", "KH_AUTH_USER", "KH_AUTH_PROJECT", "KH_AUTH_GRANT")


def lit(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def upsert(table: str, key: dict, values: dict) -> str:
    columns = list(key) + list(values)
    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in values)
    return (f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join(lit(v) for v in [*key.values(), *values.values()])}) "
            f"ON CONFLICT ({', '.join(key)}) DO UPDATE SET {updates};")


def insert_if_missing(table: str, key: dict, values: dict) -> str:
    columns = list(key) + list(values)
    return (f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join(lit(v) for v in [*key.values(), *values.values()])}) "
            f"ON CONFLICT ({', '.join(key)}) DO NOTHING;")


def script(catalog: dict, maintainer: str, projects: list[str], schema: str) -> str:
    out = [f'SET search_path TO "{schema}";', (HERE / "schema_postgres.sql").read_text(encoding="utf-8")]
    for role in catalog["roles"]:
        out.append(upsert("KH_AUTH_ROLE", {"ROLE_CODE": role["code"]},
                          {"DESCRIPTION": role["description"], "PROJECT_SCOPE": role.get("project_scope", "all")}))
    for level in catalog["levels"]:
        out.append(upsert("KH_AUTH_PROJECT_LEVEL", {"LEVEL_CODE": level["code"]},
                          {"LEVEL_RANK": level["rank"], "DESCRIPTION": level["description"]}))
    for permission in catalog["permissions"]:
        out.append(upsert("KH_AUTH_PERMISSION", {"PERMISSION_CODE": permission["code"]},
                          {"APPLIES_TO": permission["applies_to"], "DESCRIPTION": permission["description"]}))
    # The mappings are the behaviour, so they are replaced wholesale to match the catalogue.
    out.append("DELETE FROM KH_AUTH_ROLE_PERMISSION;")
    for role, codes in catalog["role_permissions"].items():
        out += [f"INSERT INTO KH_AUTH_ROLE_PERMISSION VALUES ({lit(role)}, {lit(c)});" for c in codes]
    out.append("DELETE FROM KH_AUTH_LEVEL_PERMISSION;")
    for level, codes in catalog["level_permissions"].items():
        out += [f"INSERT INTO KH_AUTH_LEVEL_PERMISSION VALUES ({lit(level)}, {lit(c)});" for c in codes]
    out.append("DELETE FROM KH_AUTH_VISIBILITY_ACCESS;")
    out += [f"INSERT INTO KH_AUTH_VISIBILITY_ACCESS VALUES ({lit(r['visibility'])}, {lit(r['role'])}, {lit(r['level'])});"
            for r in catalog.get("visibility_access", [])]
    for project in projects:
        is_system = project in catalog["system_projects"]
        out.append(insert_if_missing("KH_AUTH_PROJECT", {"PROJECT_ID": project},
                                     {"IS_SYSTEM": is_system, "STATE": "active", "CREATED_BY": maintainer}))
        if not is_system:
            out.append(insert_if_missing("KH_AUTH_GRANT", {"PROJECT_ID": project, "EMAIL": maintainer},
                                         {"LEVEL_CODE": "owner", "GRANTED_BY": "seed_postgres.py"}))
    # Default levels (catalog 'default_levels'), after the projects they name are registered.
    out.append("UPDATE KH_AUTH_PROJECT SET DEFAULT_LEVEL = NULL WHERE DEFAULT_LEVEL IS NOT NULL;")
    out += [f"UPDATE KH_AUTH_PROJECT SET DEFAULT_LEVEL = {lit(level)} WHERE PROJECT_ID = {lit(project)};"
            for project, level in catalog.get("default_levels", {}).items()]
    out.append("SELECT " + ", ".join(f"(SELECT COUNT(*) FROM {t}) AS {t.lower()}" for t in TABLES) + ";")
    return "\n".join(out) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db-file", required=True, type=Path)
    parser.add_argument("--psql", required=True)
    parser.add_argument("--maintainer", required=True)
    parser.add_argument("--project", action="append", default=[])
    args = parser.parse_args()

    db = json.loads(args.db_file.read_text(encoding="utf-8"))
    catalog = json.loads((HERE / "catalog.json").read_text(encoding="utf-8"))
    projects = sorted(set(catalog["system_projects"]) | set(args.project))
    sql = script(catalog, args.maintainer.strip().lower(), projects, db.get("schema", "public"))

    env = dict(os.environ, PGPASSWORD=db["password"], PGCLIENTENCODING="UTF8")
    run = subprocess.run([args.psql, "-X", "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-A", "-F", "\t",
                          "-h", str(db.get("host", "127.0.0.1")), "-p", str(db.get("port", 5432)),
                          "-U", db["user"], "-d", db["database"], "-f", "-"],
                         input=sql, text=True, encoding="utf-8", capture_output=True, env=env)
    if run.returncode != 0:
        sys.stderr.write(run.stderr)
        return run.returncode
    lines = [line for line in run.stdout.splitlines() if "\t" in line]
    rows = dict(zip(lines[-2].split("\t"), (int(n) for n in lines[-1].split("\t"))))
    print(json.dumps({"database": db["database"], "projects": projects, "rows": rows}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
