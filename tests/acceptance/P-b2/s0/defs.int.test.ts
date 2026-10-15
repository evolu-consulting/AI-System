// HUB-FR-104 · HUB-FR-136 · ADM-FR-71 (server) · AC-PB2-04/05/09 · test-plan-cases §3.2 `s0/defs` (DF-01…DF-09):
// `POST/PUT /process-defs`, `POST /process-defs/:tpl/copy` với `step`, `back_to_steps`, `real_action` theo bước (422
// `PROCESS_DEF_INVALID` + `details.paths`/`details.rules` cùng chỉ số, plan D10) · lỗi hình dạng ⇒ 400 `VALIDATION_ERROR`
// (mặc định readiness lần 2 #5) · `ensureHandoff` khi lưu (R10, G-5: bỏ qua `team`). DB tag `pb2_s0`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { OWNER_URL } from "../../H1/_fixtures";
import { fn, loadSeed } from "../../P-a/_support/modules";
import { defInput, fixId, insertDef, type Res } from "../../P-a/_support/pa";
import {
  type CtxPb2,
  defBody,
  type Json,
  needPb2,
  P1,
  PA_FIX,
  type Role,
  type StageOpt,
  st,
  startPb2,
} from "../_support/pb2";

let c: CtxPb2;
const TPL = fixId();
beforeAll(async () => {
  c = await startPb2({ fakeLauncher: true });
  if (!c.ready) return;
  await insertDef(c.sql, {
    id: TPL,
    tenantId: null,
    input: defInput({ key: "pb2-tpl", name: "Mẫu P-b2" }),
  });
}, 60_000);
afterAll(() => c?.stop());

const KT = PA_FIX.gKeToan;
const s = (o: StageOpt) => st(o, P1.agRead);
const post = (body: Json, who: Role = "Adm") => c.call(who, "POST", "/process-defs", body);
const get = (id: string) => c.call("Adm", "GET", `/process-defs/${id}`);
const asInput = (d: Json): Json => {
  const {
    key,
    name,
    description,
    input_hint,
    run_group_ids,
    stages,
    token_budget,
    enabled,
    sources,
    inputs,
  } = d;
  return {
    key,
    name,
    description,
    input_hint,
    run_group_ids,
    stages,
    token_budget,
    enabled,
    sources,
    inputs,
  };
};
/** 422 PROCESS_DEF_INVALID ⇒ map path → rule (cùng chỉ số). */
function rulesOf(r: Res): Record<string, string> {
  expect({ status: r.status, code: r.json?.error?.code }).toEqual({
    status: 422,
    code: "PROCESS_DEF_INVALID",
  });
  const paths = (r.json?.error?.details?.paths ?? []) as string[];
  const rules = (r.json?.error?.details?.rules ?? []) as string[];
  expect(rules.length).toBe(paths.length);
  return Object.fromEntries(paths.map((p, i) => [p, rules[i] as string]));
}
function shapeErr(r: Res): string[] {
  expect({ status: r.status, code: r.json?.error?.code }).toEqual({
    status: 400,
    code: "VALIDATION_ERROR",
  });
  return ((r.json?.error?.details?.issues ?? []) as Json[]).map((i) =>
    (i.path as unknown[]).join("."),
  );
}
const lastSec = (stage: Json) => (stage.output.required_sections as string[]).at(-1);

describe("DF · luật bước khi lưu [AC-PB2-04][HUB-FR-104]", () => {
  it("AC-PB2-04 · DF-01 · 1 stage bước 0 + 4 stage bước 1 ⇒ 422, paths có stages.4.step, rules cùng chỉ số = STEP_TOO_WIDE", async () => {
    needPb2(c.pb2);
    const stages = [
      s({ key: "a", step: 0, review: KT }),
      ...["b", "c", "d", "e"].map((k) => s({ key: k, step: 1 })),
    ];
    const m = rulesOf(await post(defBody("pb2-df01", stages)));
    expect(m["stages.4.step"]).toBe("STEP_TOO_WIDE");
  });
  it("AC-PB2-04 · DF-02 · 11 stage / step 10 / back_to_steps 10 phần tử ⇒ 400 VALIDATION_ERROR + issues[].path (không STEP_TOO_WIDE)", async () => {
    needPb2(c.pb2);
    const eleven = Array.from({ length: 11 }, (_, i) => s({ key: `k${i}`, step: i }));
    expect(
      shapeErr(await post(defBody("pb2-df02a", eleven))).some((p) => p.startsWith("stages")),
    ).toBe(true);
    const step10 = [s({ key: "a", step: 0, review: KT }), s({ key: "b", step: 10 })];
    expect(shapeErr(await post(defBody("pb2-df02b", step10)))).toContain("stages.1.step");
    const tenBack = [
      s({ key: "a", step: 0, review: KT }),
      s({ key: "b", step: 1, review: KT, back: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }),
    ];
    expect(
      shapeErr(await post(defBody("pb2-df02c", tenBack))).some((p) =>
        p.startsWith("stages.1.after"),
      ),
    ).toBe(true);
  });
  it("AC-PB2-04 · DF-03 · thiếu `step` ở 1 stage ⇒ STEP_INCOMPLETE; step [0,2] ⇒ STEP_ORDER (POST và PUT)", async () => {
    needPb2(c.pb2);
    const inc = [s({ key: "a", step: 0, review: KT }), s({ key: "b" })];
    expect(rulesOf(await post(defBody("pb2-df03a", inc)))["stages.1.step"]).toBe("STEP_INCOMPLETE");
    const ord = [s({ key: "a", step: 0, review: KT }), s({ key: "b", step: 2 })];
    expect(rulesOf(await post(defBody("pb2-df03b", ord)))["stages.1.step"]).toBe("STEP_ORDER");
    const okr = await post(
      defBody("pb2-df03c", [s({ key: "a", step: 0, review: KT }), s({ key: "b", step: 1 })]),
    );
    expect(okr.status).toBe(201);
    const put = await c.call("Adm", "PUT", `/process-defs/${okr.json.id}`, {
      ...asInput(okr.json),
      stages: ord,
      version: okr.json.version,
    });
    expect(rulesOf(put)["stages.1.step"]).toBe("STEP_ORDER");
  });
  it("HUB-FR-118 · DF-04 · back_to_steps [2] ở stage bước 2 ⇒ BACK_TARGET_INVALID path stages.2.after.back_to_steps.0", async () => {
    needPb2(c.pb2);
    const stages = [
      s({ key: "a", step: 0, review: KT }),
      s({ key: "b", step: 1, review: KT }),
      s({ key: "c", step: 2, review: KT, back: [2] }),
    ];
    expect(rulesOf(await post(defBody("pb2-df04", stages)))).toEqual({
      "stages.2.after.back_to_steps.0": "BACK_TARGET_INVALID",
    });
  });
  it("AC-PB2-05 · DF-05 · real_action bước 2 khi bước 1 {review, auto} ⇒ 422 REAL_ACTION; {review, review} ⇒ 201", async () => {
    needPb2(c.pb2);
    const mk = (secondAuto: boolean) => [
      s({ key: "a", step: 0, review: KT }),
      s({ key: "b", step: 1, review: KT }),
      secondAuto ? s({ key: "c", step: 1 }) : s({ key: "c", step: 1, review: KT }),
      s({ key: "d", step: 2, agent: P1.agPost, real: true }),
    ];
    expect(rulesOf(await post(defBody("pb2-df05a", mk(true))))).toEqual({
      "stages.3.real_action": "REAL_ACTION",
    });
    expect((await post(defBody("pb2-df05b", mk(false)))).status).toBe(201);
  });
});

describe("DF · Bàn giao tự thêm khi lưu [AC-PB2-09][HUB-FR-136]", () => {
  it("AC-PB2-09 · DF-06 · POST thiếu 'Bàn giao' ⇒ thêm cuối required_sections + '## Bàn giao\\n' cuối template; PUT lại không nhân đôi; copy mẫu có 'Bàn giao'", async () => {
    needPb2(c.pb2);
    const stages = [s({ key: "a", step: 0, review: KT }), s({ key: "b", step: 1 })];
    const r = await post(defBody("pb2-df06", stages));
    expect(r.status).toBe(201);
    const g = (await get(r.json.id)).json;
    for (const d of [r.json, g])
      for (const st0 of d.stages as Json[]) {
        expect(lastSec(st0)).toBe("Bàn giao");
        expect(String(st0.output.template).endsWith("## Bàn giao\n")).toBe(true);
      }
    const put = await c.call("Adm", "PUT", `/process-defs/${g.id}`, {
      ...asInput(g),
      version: g.version,
    });
    expect(put.status).toBe(200);
    const n = (put.json.stages[0].output.required_sections as string[]).filter(
      (x) => x === "Bàn giao",
    ).length;
    expect(n).toBe(1);
    expect((String(put.json.stages[0].output.template).match(/## Bàn giao/g) ?? []).length).toBe(1);
    const cp = await c.call("Adm", "POST", `/process-defs/${TPL}/copy`, { key: "pb2-df06-copy" });
    expect(cp.status).toBe(201);
    for (const st0 of cp.json.stages as Json[]) expect(lastSec(st0)).toBe("Bàn giao");
  });
  it("AC-PB2-09 · DF-07 · mẫu platform (seed) KHÔNG bị thêm 'Bàn giao' (seed/migration không qua ensureHandoff)", async () => {
    needPb2(c.pb2);
    const m = await loadSeed();
    await fn(
      m,
      "runHubSeed",
    )({ url: OWNER_URL, dir: m.DEFAULT_SEED_DIR, appEnv: "development", fixtures: true });
    const [tpl] = await c.sql<
      Json[]
    >`select id from hub.process_defs where tenant_id is null and key = 'sdlc'`;
    expect(tpl).toBeDefined();
    const d = (await get(tpl?.id)).json;
    for (const st0 of (d?.stages ?? []) as Json[])
      expect((st0.output.required_sections as string[]).includes("Bàn giao")).toBe(false);
  });
  it("HUB-BR-25 · DF-08 · tenant_admin beta PUT def acme ⇒ 404 (không lộ)", async () => {
    needPb2(c.pb2);
    const r = await post(defBody("pb2-df08", [s({ key: "a", step: 0 })]));
    expect(r.status).toBe(201);
    const put = await c.call("Db", "PUT", `/process-defs/${r.json.id}`, {
      ...asInput(r.json),
      version: r.json.version,
    });
    expect(put.status).toBe(404);
  });
  it("HUB-FR-136 · DF-09 · G-5 · def có stage `team` + stage `agent` (đều thiếu) ⇒ chỉ stage agent được thêm 'Bàn giao'", async () => {
    needPb2(c.pb2);
    const stages = [
      s({
        key: "nhom",
        name: "Nhóm đọc",
        step: 0,
        team: P1.teamPm,
        sections: ["Phần A", "Phần B"],
        review: KT,
      }),
      s({ key: "doc", name: "Đọc đơn", step: 1 }),
    ];
    const r = await post(defBody("pb2-df09", stages));
    expect(r.status).toBe(201);
    const g = (await get(r.json.id)).json;
    for (const d of [r.json, g]) {
      expect(d.stages[0].output.required_sections).toEqual(["Phần A", "Phần B"]);
      expect(lastSec(d.stages[1])).toBe("Bàn giao");
    }
  });
});
