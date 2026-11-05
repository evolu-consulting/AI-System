// CR-121 P-1 · kiểm trước deploy (deploy/prod-sohoptac2/preflight-cr121.sql): câu SQL chạy được trên DB đã migrate đủ, trong giao dịch
// READ ONLY, và phát hiện công ty đọc được gói contracts mà thiếu nhóm contracts-editor (CHẶN). Không ghi gì ngoài dữ liệu mồi của test.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { runMigrations } from "./migrate";
import { readJournal } from "./migrate-guard";
import { runHubMigrations } from "./migrate-hub";
import { runPackMigrations } from "./migrate-packs";

const URL = process.env.TEST_DATABASE_URL;
if (!URL) throw new Error("TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev`");
const sql = postgres(URL, { max: 1, onnotice: () => {} });
afterAll(() => sql.end());

const here = (p: string) => fileURLToPath(new globalThis.URL(p, import.meta.url));
const SQL_FILE = here("../../../deploy/prod-sohoptac2/preflight-cr121.sql");
const lastOf = (dir: string) => {
  const j = readJournal(here(`../${dir}`));
  return { when: j.at(-1)?.when ?? 0, n: j.length };
};

/** Chạy file như psql: bỏ dòng chú thích + BEGIN/ROLLBACK, thay `:biến`, mọi câu trong MỘT giao dịch READ ONLY. */
async function runPreflight(vars: Record<string, number>): Promise<string[][]> {
  const text = readFileSync(SQL_FILE, "utf8")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")
    .replace(/(?<!:):([a-z_]+)\b/g, (_m, k: string) => String(vars[k] ?? -1));
  const stmts = text
    .split(/;[ \t]*\n/)
    .map((s) => s.trim())
    .filter((s) => s && !/^(BEGIN|ROLLBACK)\b/i.test(s));
  const rows: string[][] = [];
  await sql.begin("read only", async (tx) => {
    for (const s of stmts) {
      const r = await tx.unsafe(s).values();
      for (const row of r) rows.push(row.map((c) => (c == null ? "" : String(c))));
    }
  });
  return rows;
}

describe("CR-121 P-1 · preflight-cr121.sql (int, chỉ đọc)", () => {
  test("chạy được trên DB đủ migration; journal hub khớp ⇒ OK; công ty có contracts-read thiếu contracts-editor ⇒ CHẶN theo tên công ty", async () => {
    await runMigrations({ url: URL, appEnv: "test" });
    await runHubMigrations({ url: URL, appEnv: "test" });
    await runPackMigrations({ url: URL, appEnv: "test" });
    const hub = lastOf("migrations-hub");
    const suffix = Math.random().toString(36).slice(2, 8);
    const tkey = `pf-${suffix}`;
    const [t] = await sql<{ id: string }[]>`
      insert into admin.tenants (key, name) values (${tkey}, ${`Preflight ${suffix}`}) returning id`;
    const tenantId = t?.id ?? "";
    const [pre] = await sql<
      { id: string }[]
    >`select id from admin.features where key = 'contracts-read'`;
    let featureId = pre?.id;
    const createdFeature = !featureId;
    if (!featureId) {
      const [f] = await sql<{ id: string }[]>`
        insert into admin.features (key, name) values ('contracts-read', ${sql.json({ vi: "Hợp đồng", en: "Contracts" })}) returning id`;
      featureId = f?.id;
    }
    await sql`insert into admin.feature_entitlements (feature_id, tenant_id) values (${featureId ?? ""}, ${tenantId})`;
    try {
      const rows = await runPreflight({ hub_when: hub.when, hub_n: hub.n });
      const by = (id: string) => rows.filter((r) => r[0] === id);
      expect(by("pg-version")[0]?.[1]).toBe("OK");
      expect(by("view-deps")[0]?.[1]).toBe("OK"); // 0099 đã gỡ view trên DB đủ migration
      expect(by("mig-hub")[0]?.[1]).toBe("OK");
      expect(by("run-rows")[0]?.[1]).toBe("OK");
      expect(by("machine-open")).toHaveLength(1);
      const groups = by("flow-groups").find((r) => r[2]?.includes(`(${tkey})`));
      expect(groups?.[1]).toBe("BLOCK");
      expect(groups?.[2]).toContain("contracts-editor");
      expect(groups?.[2]).toContain(`Preflight ${suffix}`);
      // khe: hoặc có mẫu mặc định (OK) hoặc CHẶN nêu tên công ty — không bao giờ im lặng
      const slot = by("flow-slot");
      expect(slot.length).toBeGreaterThan(0);
      for (const r of slot) expect(["OK", "BLOCK"]).toContain(r[1] ?? "");
    } finally {
      await sql`delete from admin.feature_entitlements where tenant_id = ${tenantId}`;
      await sql`delete from admin.tenants where id = ${tenantId}`;
      if (createdFeature && featureId)
        await sql`delete from admin.features where id = ${featureId}`;
    }
  });
});
