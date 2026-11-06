// CR-122 · B · seed 3 flow mẫu vào Thư viện trên DB thật (pool hub_api, scope system): đã xuất bản (bản 1, release bất biến), có trigger
// `contract.submitted` + app `contracts`, KHÔNG khe; đọc lại từ DB vẫn qua `parseFlowDef` + `flowDefIssues`; chạy lại KHÔNG nhân bản và
// KHÔNG đè bản đã sửa; không lộ cho scope công ty như một def của họ (def Thư viện `tenant_id` null).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { CONTRACTS_MANIFEST } from "@ai/contracts/app-manifest";
import { flowDefIssues, parseFlowDef } from "@ai/contracts/hub-admin";
import { createDb, type Db } from "@ai/db";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { FLOW_TEMPLATES } from "./flow-templates.def";
import { seedFlowTemplates } from "./flow-templates.seed";

let o: Sql;
let db: Db;
const KEYS = FLOW_TEMPLATES.map((t) => t.key);

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = createDb(urls().hubApi, { max: 2 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const rows = () =>
  o<
    {
      id: string;
      key: string;
      slot: string | null;
      app: string | null;
      trigger: { event: string };
      published_version: number | null;
      stages: unknown;
      nrel: number;
    }[]
  >`select d.id, d.key, d.slot, d.app, d.trigger, d.published_version, d.stages,
      (select count(*)::int from hub.process_def_releases r where r.def_id = d.id) as nrel
    from hub.process_defs d where d.tenant_id is null and d.key = any(${o.array(KEYS)}::text[]) order by d.key`;

describe("CR-122 B · seed flow mẫu", () => {
  it("tạo 3 flow mẫu đã xuất bản (bản 1), có trigger + app, không khe, đọc lại vẫn hợp lệ", async () => {
    const r = await seedFlowTemplates(db);
    expect(r.created.sort()).toEqual([...KEYS].sort());
    const got = await rows();
    expect(got.map((x) => x.key)).toEqual([...KEYS].sort());
    for (const g of got) {
      expect(g).toMatchObject({
        slot: null,
        app: "contracts",
        trigger: { event: "contract.submitted" },
        published_version: 1,
        nrel: 1,
      });
      const t = FLOW_TEMPLATES.find((x) => x.key === g.key);
      const def = {
        key: g.key,
        name: t?.name,
        app: g.app,
        owner: "library",
        trigger: g.trigger,
        stages: g.stages,
      };
      const p = parseFlowDef(def);
      expect(p.ok && !p.legacy).toBe(true);
      expect(flowDefIssues(def as never, CONTRACTS_MANIFEST.events)).toEqual([]);
    }
  });

  it("chạy lại không nhân bản (3 def, mỗi def 1 release) và không đè bản đã đổi", async () => {
    await o`update hub.process_defs set name = 'Đã sửa tay' where key = 'hd-duyet-2-cap' and tenant_id is null`;
    const r = await seedFlowTemplates(db);
    expect(r.created).toEqual([]);
    expect(r.existing.sort()).toEqual([...KEYS].sort());
    const got = await rows();
    expect(got).toHaveLength(3);
    expect(got.every((g) => g.nrel === 1)).toBe(true);
    const [n] = await o<
      { name: string }[]
    >`select name from hub.process_defs where key = 'hd-duyet-2-cap' and tenant_id is null`;
    expect(n?.name).toBe("Đã sửa tay");
  });
});
