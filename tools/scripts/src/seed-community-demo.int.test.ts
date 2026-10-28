// com-c12a · seed cộng đồng đối tác: --apply hai lần (không trùng, mật khẩu chỉ ở file), dry-run chỉ in kế hoạch, user ngoài không vào Group.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@ai/db";
import { ADMIN_API_URL, createEnv, type Env } from "../../../tests/acceptance/M1/_fixtures";
import { assertTenant, runSeed, type SeedOpts } from "./seed-community-demo";
import { PARTNER_SEEDS } from "./seed-community-demo.data";

let env: Env;
let db: Db;
let dir: string;
beforeAll(async () => {
  env = await createEnv();
  db = createDb(ADMIN_API_URL, { max: 3 });
  dir = mkdtempSync(join(tmpdir(), "seed-community-"));
});
afterAll(async () => {
  await db.close();
  await env.close();
  rmSync(dir, { recursive: true, force: true });
});

const opts = (o: Partial<SeedOpts> = {}): SeedOpts => ({
  tenantKey: "acme",
  forceTenant: true,
  apply: true,
  out: join(dir, "pw.json"),
  log: () => {},
  ...o,
});
const count = async (sqlText: string) => {
  const [r] = await env.owner.unsafe(sqlText);
  return (r as unknown as { n: number }).n;
};

describe("com-c12a · seed-community-demo", () => {
  it("từ chối tenant khác demo nếu không có --force-tenant", () => {
    expect(() => assertTenant("nitigroup", false)).toThrow();
    expect(() => assertTenant("demo", false)).not.toThrow();
  });

  it("dry-run: chỉ in kế hoạch, không ghi DB/file", async () => {
    const lines: string[] = [];
    await runSeed(db, opts({ apply: false, log: (s) => lines.push(s) }));
    expect(lines.join("\n")).toContain("Cơ sở Tân Phát");
    expect(await count("select count(*)::int n from admin.external_orgs")).toBe(0);
    expect(existsSync(join(dir, "pw.json"))).toBe(false);
  });

  it("--apply hai lần: không trùng, mật khẩu chỉ ở file, user ngoài không vào Group", async () => {
    const n = PARTNER_SEEDS.length;
    const a = await runSeed(db, opts());
    expect(a.orgs).toEqual({ created: n, existing: 0 });
    expect(a.users).toEqual({ created: n, existing: 0 });
    const b = await runSeed(db, opts());
    expect(b.orgs).toEqual({ created: 0, existing: n });
    expect(b.users).toEqual({ created: 0, existing: n });
    expect(await count("select count(*)::int n from admin.external_orgs")).toBe(n);
    expect(
      await count(
        "select count(*)::int n from admin.users where kind = 'external' and must_change_password",
      ),
    ).toBe(n);

    const pw = JSON.parse(readFileSync(join(dir, "pw.json"), "utf8")) as {
      users: Record<string, string>;
    };
    expect(Object.keys(pw.users).sort()).toEqual(PARTNER_SEEDS.map((p) => p.username).sort());
    const map = JSON.parse(readFileSync(`${join(dir, "pw.json")}.community.json`, "utf8"));
    const tp = map.partners.find((p: { org_name: string }) => p.org_name === "Cơ sở Tân Phát");
    expect(tp.party_key).toBe("tax:0101000003");

    const t = await env.token("acme", "binh");
    const g = await env.post("/admin/groups", {
      token: t,
      body: { key: "ke-toan", name: { vi: "Kế toán" } },
    });
    expect(g.status).toBe(201);
    const r = await env.post(`/admin/groups/${g.json.id}/members`, {
      token: t,
      body: { usernames: ["doitac-tanphat"] },
    });
    expect(r.status).toBe(422);
  });
});
