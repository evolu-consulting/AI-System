// CR-121 c9 · R9 · int: `GET /process-runs?slot=&def_id=` — lọc cùng câu liệt kê; tenant_admin chỉ thấy lượt công ty mình (chặn đọc
// chéo công ty); lượt theo khe nhận diện qua `snapshot.process_def_id` (ghi lúc launch theo luật) kể cả khi chạy bằng bản riêng sao từ
// def thư viện của khe.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type CtxPa, PA, startPa } from "../../../../../../tests/acceptance/P-a/_support/pa";
import {
  defInput,
  insertDef,
  insertRun,
} from "../../../../../../tests/acceptance/P-a/_support/process-fixtures";

const D = {
  libA: "c1219000-0000-4000-8000-000000000001", // thư viện khe contracts.approval
  libI: "c1219000-0000-4000-8000-000000000002", // thư viện khe contracts.intake
  acme: "c1219000-0000-4000-8000-000000000003", // def vật chất hoá của acme
  copy: "c1219000-0000-4000-8000-000000000004", // bản riêng của acme sao từ libA
  beta: "c1219000-0000-4000-8000-000000000005",
};
const runs = {} as Record<"a1" | "i1" | "c1" | "b1" | "plain", string>;

let c: CtxPa;
beforeAll(async () => {
  c = await startPa();
  const lib = async (id: string, key: string, slot: string) => {
    await insertDef(c.sql, { id, tenantId: null, input: defInput({ key }) });
    await c.sql`update hub.process_defs set slot = ${slot}, published_version = 1 where id = ${id}`;
  };
  await lib(D.libA, "cc-lib-a", "contracts.approval");
  await lib(D.libI, "cc-lib-i", "contracts.intake");
  await insertDef(c.sql, { id: D.acme, tenantId: PA.Adm.tid, input: defInput({ key: "cc-acme" }) });
  await insertDef(c.sql, { id: D.copy, tenantId: PA.Adm.tid, input: defInput({ key: "cc-copy" }) });
  await c.sql`update hub.process_defs set source_template_id = ${D.libA}, source_rel_version = 1 where id = ${D.copy}`;
  await insertDef(c.sql, { id: D.beta, tenantId: PA.Db.tid, input: defInput({ key: "cc-beta" }) });
  const mk = async (who: typeof PA.Adm, def: string, key: string, libId: string | null) => {
    const d = defInput({ key });
    const fx = await insertRun(c.sql, {
      def: { id: def, key, name: d.name as string, stages: d.stages as never },
      startedBy: who,
    });
    if (libId)
      await c.sql`update hub.process_runs set snapshot = snapshot || ${c.sql.json({ process_def_id: libId })} where id = ${fx.runId}`;
    return fx.runId;
  };
  runs.a1 = await mk(PA.Adm, D.acme, "cc-acme", D.libA);
  runs.i1 = await mk(PA.Adm, D.acme, "cc-acme", D.libI);
  runs.c1 = await mk(PA.Adm, D.copy, "cc-copy", D.copy);
  runs.plain = await mk(PA.Adm, D.acme, "cc-acme", null); // lượt thường, không theo khe
  runs.b1 = await mk(PA.Db, D.beta, "cc-beta", D.libA); // công ty khác dùng chính def thư viện đó
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

type List = { items: { id: string }[]; next_cursor: string | null };
const ids = async (who: "Adm" | "Db" | "P", q: string) =>
  ((await c.call(who, "GET", `/process-runs?scope=tenant${q}`)).json as List).items
    .map((i) => i.id)
    .sort();

describe("CR-121 c9 · lượt chạy lọc theo khe / def", () => {
  it("lọc slot gồm def thư viện + bản riêng của chính công ty, công ty khác không lọt", async () => {
    expect(await ids("Adm", "&slot=contracts.approval")).toEqual([runs.a1, runs.c1].sort());
    expect(await ids("Adm", "&slot=contracts.intake")).toEqual([runs.i1]);
    expect(await ids("Db", "&slot=contracts.approval")).toEqual([runs.b1]); // chỉ lượt của beta
    expect(await ids("Adm", "&slot=contracts.nothing")).toEqual([]);
  });

  it("lọc def_id (thư viện hoặc bản riêng), giao với slot, không lọc ⇒ đủ", async () => {
    expect(await ids("Adm", `&def_id=${D.libA}`)).toEqual([runs.a1]);
    expect(await ids("Adm", `&def_id=${D.copy}`)).toEqual([runs.c1]);
    expect(await ids("Adm", `&slot=contracts.approval&def_id=${D.libI}`)).toEqual([]); // khác khe ⇒ rỗng
    expect(await ids("Adm", `&slot=contracts.approval&def_id=${D.copy}`)).toEqual([runs.c1]);
    expect((await ids("Adm", "")).length).toBe(4); // a1, i1, c1, plain
  });

  it("slot sai định dạng ⇒ 400; phân trang giữ bộ lọc", async () => {
    expect((await c.call("Adm", "GET", "/process-runs?slot=KHONG-HOP-LE")).status).toBe(400);
    const p1 = await c.call(
      "Adm",
      "GET",
      "/process-runs?scope=tenant&slot=contracts.approval&limit=1",
    );
    const l1 = p1.json as List;
    expect(l1.items.length).toBe(1);
    expect(l1.next_cursor).not.toBeNull();
    const p2 = await c.call(
      "Adm",
      "GET",
      `/process-runs?scope=tenant&slot=contracts.approval&limit=1&cursor=${l1.next_cursor}`,
    );
    const got = [...l1.items, ...(p2.json as List).items].map((i) => i.id).sort();
    expect(got).toEqual([runs.a1, runs.c1].sort());
  });
});
