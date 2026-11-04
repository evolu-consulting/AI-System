// CR-118 · cr118-boot-packs · stack chỉ migrate Hub (thiếu `packs.pack_agents`) ⇒ Hub vẫn khởi động: ảnh Hub nạp được với
// agent gói rỗng (đóng an toàn), kiểm Orchestrator lúc boot không ném, `/health` 200; đủ schema ⇒ đọc bảng như cũ. Dò một lần
// mỗi `Db` (nóng 0 SQL thêm). Mô phỏng "vắng" bằng đổi tên bảng trong DB clone riêng của file.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createApp } from "../../app";
import { connectDb, type Db, pingDb } from "../../lib/db";
import { loadHubSnapshot, loadUsers, readVersions } from "./config.repo";
import { bootOrchestratorProblem } from "./config.service";
import { hubSchemaCaps } from "./schema-caps";

let o: Sql;
const dbs: Db[] = [];
const hubDb = () => {
  const d = connectDb(urls().hubApi, 2);
  dbs.push(d);
  return d;
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(1);
}, 120_000);
afterAll(async () => {
  for (const d of dbs) await d.close();
  await o?.end({ timeout: 2 });
});

describe("CR-118 · cr118-boot-packs · schema tuỳ chọn", () => {
  it("đủ schema ⇒ đọc packs.pack_agents như cũ", async () => {
    const db = hubDb();
    const [n] = await o<{ n: number }[]>`select count(*)::int as n from packs.pack_agents`;
    const caps = await hubSchemaCaps(db);
    const snap = await loadHubSnapshot(db);
    const total = [...(snap.packAgents?.values() ?? [])].reduce((s, a) => s + a.length, 0);
    expect({ caps, total }).toEqual({
      caps: {
        packAgents: true,
        userDefaultApp: true,
        tenantDefaultApp: true,
        profileVersion: true,
      },
      total: n?.n ?? -1,
    });
  });

  it("thiếu packs.pack_agents ⇒ agent gói rỗng, boot không ném, /health 200, nóng 0 SQL dò thêm", async () => {
    await o`alter table packs.pack_agents rename to pack_agents_hidden_r1`;
    try {
      const db = hubDb();
      const first = await hubSchemaCaps(db);
      expect(first.packAgents).toBe(false);
      expect(hubSchemaCaps(db)).toBe(hubSchemaCaps(db)); // nhớ: không dò lại
      const snap = await loadHubSnapshot(db);
      expect(snap.packAgents?.size ?? 0).toBe(0);
      await bootOrchestratorProblem(db); // không ném (trước đây: relation does not exist ⇒ fatal)
      await readVersions(db);
      const [u] = await o<{ id: string }[]>`select id::text as id from admin.users limit 1`;
      if (u) expect((await loadUsers(db, [u.id])).length).toBe(1);
      const ac = new AbortController();
      const app = createApp({ version: "0.0.0-test", corsOrigins: [] }, {
        db,
        probes: [() => pingDb(db)],
        appEnv: "test",
        signal: ac.signal,
      } as never);
      try {
        expect((await app.request("/health")).status).toBe(200);
      } finally {
        ac.abort();
      }
    } finally {
      await o`alter table packs.pack_agents_hidden_r1 rename to pack_agents`;
    }
  });
});
