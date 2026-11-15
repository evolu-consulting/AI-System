// Migration hub chạy TRƯỚC khi bộ khung gói (migrations-packs) tạo role gói (contracts_rw, community_rw…). Lệnh cấp quyền hàm
// hub cho role gói đặt trong migration hub (khối DO «nếu role đã có») bị BỎ QUA trên DB dựng sạch ⇒ 42501 ở prod (2026-11-16:
// contract_received_params, partner_email_history, cc_connected). Luật: hàm hub nào migration hub cấp cho role gói thì migration
// của gói đó phải cấp lại (không điều kiện) — test tĩnh này bắt ở tầng unit thay vì lúc deploy.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DB_DIR = fileURLToPath(new URL("..", import.meta.url));
const PACK_ROLE = /^(contracts|community|knowledge|dlc)_(rw|ro|job)$/;

function sqlOf(folder: string): string {
  const dir = join(DB_DIR, folder);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n")
    .replace(/--[^\n]*/g, " ");
}

/** Cặp «role → hàm hub» từ mọi `GRANT EXECUTE ON FUNCTION hub.a(..), hub.b(..) TO r1, r2`. */
export function hubFnGrants(sql: string): Set<string> {
  const out = new Set<string>();
  const flat = sql.replace(/\s+/g, " ");
  for (const m of flat.matchAll(/GRANT EXECUTE ON FUNCTION (.+?) TO ([\w, ]+?)\s*;/gi)) {
    const fns = [...(m[1] as string).matchAll(/\bhub\.(\w+)\s*\(/g)].map((x) => x[1] as string);
    const roles = (m[2] as string).split(",").map((r) => r.trim());
    for (const r of roles) for (const f of fns) out.add(`${r} → hub.${f}`);
  }
  return out;
}

/** Hàm hub còn tồn tại sau toàn bộ migration (CREATE/DROP theo đúng thứ tự file + vị trí). */
export function liveHubFns(sql: string): Set<string> {
  const live = new Set<string>();
  const flat = sql.replace(/\s+/g, " ");
  // 3 dạng: CREATE … FUNCTION hub.x · DROP FUNCTION [IF EXISTS] hub.x(..), hub.y · gỡ động theo tên
  // (`proname IN ('x','y') … EXECUTE 'DROP FUNCTION '`, vd hub 0149).
  const re =
    /CREATE (?:OR REPLACE )?FUNCTION hub\.(\w+)|DROP FUNCTION (?:IF EXISTS )?((?:hub\.\w+(?:\([^)]*\))?\s*,?\s*)+)|proname IN \(([^)]*)\)[^;]*?EXECUTE 'DROP FUNCTION/gi;
  for (const m of flat.matchAll(re)) {
    if (m[1]) live.add(m[1]);
    else if (m[2]) for (const d of m[2].matchAll(/hub\.(\w+)/g)) live.delete(d[1] as string);
    else for (const d of (m[3] as string).matchAll(/'(\w+)'/g)) live.delete(d[1] as string);
  }
  return live;
}

describe("pack-role-grants", () => {
  test("hubFnGrants tách danh sách nhiều hàm, nhiều role", () => {
    const sql =
      "GRANT EXECUTE ON FUNCTION\n hub.a(uuid),\n hub.b(text, int) TO contracts_rw, hub_rw;";
    expect([...hubFnGrants(sql)].sort()).toEqual([
      "contracts_rw → hub.a",
      "contracts_rw → hub.b",
      "hub_rw → hub.a",
      "hub_rw → hub.b",
    ]);
  });

  test("liveHubFns: DROP sau CREATE ⇒ không còn; CREATE lại ⇒ còn", () => {
    const sql =
      "CREATE FUNCTION hub.a() ...; CREATE OR REPLACE FUNCTION hub.b() ...; DROP FUNCTION IF EXISTS hub.a(uuid), hub.b(text); CREATE FUNCTION hub.b() ...;" +
      " CREATE FUNCTION hub.c() ...; FOR r IN SELECT 1 WHERE p.proname IN ('c', 'z') LOOP EXECUTE 'DROP FUNCTION ' || r.sig;";
    expect([...liveHubFns(sql)]).toEqual(["b"]);
  });

  test("hàm hub cấp cho role gói trong migration hub ⇒ migration gói cũng cấp lại", () => {
    const hubSql = sqlOf("migrations-hub");
    const live = liveHubFns(hubSql);
    const fromHub = [...hubFnGrants(hubSql)].filter((g) => {
      const [role, fn] = g.split(" → hub.") as [string, string];
      return PACK_ROLE.test(role) && live.has(fn);
    });
    const packs = readdirSync(DB_DIR).filter((d) => d.startsWith("migrations-pack-"));
    const fromPacks = new Set(packs.flatMap((p) => [...hubFnGrants(sqlOf(p))]));
    expect(fromHub.length).toBeGreaterThan(0);
    expect(fromHub.filter((g) => !fromPacks.has(g)).sort()).toEqual([]);
  });
});
