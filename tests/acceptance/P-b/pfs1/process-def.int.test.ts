// P-b · PF-S1 · HUB-FR-121 · ADM-FR-69 · PB-R06 · C14 · AC-H36(d) · P-01…P-09 (test-plan §4.1): process_defs có `sources`/`inputs`,
// stage `sources`/`allowlist`/`must_know`; PROCESS_REF_INVALID; nguồn cùng tenant; chép mẫu.
// Đỏ trước code: contract `ProcessDefInputBaseSchema` strict ⇒ 422 VALIDATION_ERROR (field `sources` lạ) thay vì 201; chưa có bảng sources.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { defInput, insertDef } from "../../P-a/_support/pa";
import {
  type Ctx1,
  code,
  defWithSource,
  gitBody,
  insertSource,
  type Json,
  mkSource,
  resetPfs1,
  stageDef,
  startPfs1,
  T,
  vcode,
} from "./_local";

let c: Ctx1;
beforeAll(async () => {
  c = await startPfs1();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});
beforeEach(async () => {
  await resetPfs1(c.sql);
});

const getDef = (id: string) => c.call("Adm", "GET", `/process-defs/${id}`);
const post = (body: Json, role: "Adm" | "Db" = "Adm") =>
  c.call(role, "POST", "/process-defs", body);
const INPUT_KEYS = [
  "key",
  "name",
  "description",
  "input_hint",
  "run_group_ids",
  "stages",
  "token_budget",
  "enabled",
  "sources",
  "inputs",
];
const asInput = (d: Json): Json => Object.fromEntries(INPUT_KEYS.map((k) => [k, d[k]]));

describe("P-01 · P-06 · round-trip [HUB-FR-121]", () => {
  it("HUB-FR-121 · P-01 · def p-src sources + stage s1 allowlist + must_know ⇒ 201 và GET round-trip đúng", async () => {
    await mkSource(c, "Adm", gitBody("app-repo"));
    const body = defWithSource("pbx-p01", "app-repo", { must_know: ["Phiên bản cần sửa?"] });
    const r = await post(body);
    expect(r.status).toBe(201);
    const got = await getDef(r.json.id);
    expect(got.status).toBe(200);
    expect(got.json.sources).toEqual(["app-repo"]);
    expect(got.json.stages[0].sources).toEqual([{ source_key: "app-repo", allowlist: ["src/**"] }]);
    expect(got.json.stages[0].must_know).toEqual(["Phiên bản cần sửa?"]);
  });

  it("HUB-FR-121 · AC-H37 · P-06 · inputs 3 loại round-trip (source_ref, text, select+options)", async () => {
    const inputs = [
      { key: "repo", label: "Repo + branch", type: "source_ref", required: true },
      { key: "goal", label: "Mục tiêu", type: "text", required: false },
      { key: "env", label: "Môi trường", type: "select", required: false, options: ["dev", "stg"] },
    ];
    await mkSource(c, "Adm", gitBody("app-repo"));
    const r = await post(defWithSource("pbx-p06", "app-repo", { inputs }));
    expect(r.status).toBe(201);
    const got = await getDef(r.json.id);
    expect(got.json.inputs).toEqual(inputs);
  });
});

describe("P-02…P-05 · tham chiếu hợp lệ [PB-R06, AC-H36(d)]", () => {
  it("HUB-FR-121 · P-02 · stage tham chiếu key ∉ def.sources ⇒ 422 PROCESS_REF_INVALID", async () => {
    await mkSource(c, "Adm", gitBody("app-repo"));
    const body = defWithSource("pbx-p02", "app-repo", {
      sources: ["app-repo"],
      stageSources: [{ source_key: "khac-key", allowlist: [] }],
    });
    const r = await post(body);
    expect(code(r)).toEqual({ status: 422, code: "PROCESS_REF_INVALID" });
    expect(String(r.json.error.details?.path ?? "")).toMatch(/^stages\.0\.sources\.0/);
  });

  it("PB-R06 · AC-H36(d) · P-03 · def acme tham chiếu key chỉ có ở beta ⇒ 404 SOURCE_NOT_FOUND", async () => {
    await insertSource(c.sql, {
      tenant: T.beta,
      key: "beta-repo",
      kind: "git_remote",
      config: gitBody("x").config as Json,
    });
    const r = await post(defWithSource("pbx-p03", "beta-repo"));
    expect(code(r)).toEqual({ status: 404, code: "SOURCE_NOT_FOUND" });
    const [n] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from hub.process_defs where key = 'pbx-p03'`;
    expect(n?.n).toBe(0);
  });

  it("PB-R06 · P-04 · 6 nguồn/stage, allowlist `../x`, `/abs` ⇒ 422 VALIDATION_ERROR", async () => {
    const keys = ["s-aa", "s-bb", "s-cc", "s-dd", "s-ee", "s-ff"];
    for (const k of keys) await mkSource(c, "Adm", gitBody(k));
    // Đối chứng: 5 nguồn hợp lệ ⇒ 201 (loại xanh giả do trường `sources` bị từ chối chỉ vì chưa có trong contract).
    const fiveKeys = keys.slice(0, 5);
    const five = await post(
      defWithSource("pbx-p04ok", "s-aa", {
        sources: fiveKeys,
        stageSources: fiveKeys.map((k) => ({ source_key: k, allowlist: [] })),
      }),
    );
    expect(five.status).toBe(201);
    const six = await post(
      defWithSource("pbx-p04a", "s-aa", {
        sources: keys,
        stageSources: keys.map((k) => ({ source_key: k, allowlist: [] })),
      }),
    );
    expect(vcode(six)).toEqual({ status: 422, code: "VALIDATION_ERROR" });
    for (const bad of ["../x", "/abs"]) {
      const r = await post(
        defWithSource(`pbx-p04-${bad.length}`, "s-aa", {
          stageSources: [{ source_key: "s-aa", allowlist: [bad] }],
        }),
      );
      expect(vcode(r)).toEqual({ status: 422, code: "VALIDATION_ERROR" });
    }
  });

  it("PB-R06 · C14 · P-05 · chép mẫu platform tham chiếu key tenant không có ⇒ 404 SOURCE_NOT_FOUND", async () => {
    const col = await c.sql`select 1 from information_schema.columns where table_schema = 'hub'
      and table_name = 'process_defs' and column_name = 'sources'`;
    expect({ process_defs_sources_column: col.length === 1 }).toEqual({
      process_defs_sources_column: true,
    });
    const tplId = "b1b10000-0000-4000-8000-0000000000a5";
    const input = defWithSource("pbx-tpl", "app-repo");
    await insertDef(c.sql, { id: tplId, tenantId: null, input });
    await c.sql`update hub.process_defs set sources = ${c.sql.json(["app-repo"])}, stages = ${c.sql.json(input.stages)} where id = ${tplId}`;
    const r = await c.call("Adm", "POST", `/process-defs/${tplId}/copy`, { key: "pbx-copy" });
    expect(code(r)).toEqual({ status: 404, code: "SOURCE_NOT_FOUND" });
    // Có nguồn trong tenant ⇒ chép được
    await mkSource(c, "Adm", gitBody("app-repo"));
    const ok = await c.call("Adm", "POST", `/process-defs/${tplId}/copy`, { key: "pbx-copy" });
    expect(ok.status).toBe(201);
    expect(ok.json.sources).toEqual(["app-repo"]);
  });
});

describe("P-07…P-09 · version, xoá mềm, tương thích P-a [HUB-FR-121]", () => {
  it("HUB-FR-121 · P-07 · PUT def version cũ ⇒ 409 VERSION_CONFLICT", async () => {
    await mkSource(c, "Adm", gitBody("app-repo"));
    const r = await post(defWithSource("pbx-p07", "app-repo"));
    expect(r.status).toBe(201);
    const input = asInput(r.json);
    const ok = await c.call("Adm", "PUT", `/process-defs/${r.json.id}`, {
      ...input,
      name: "v2",
      version: r.json.version,
    });
    expect(ok.status).toBe(200);
    const again = await c.call("Adm", "PUT", `/process-defs/${r.json.id}`, {
      ...input,
      name: "v3",
      version: r.json.version,
    });
    expect(code(again)).toEqual({ status: 409, code: "VERSION_CONFLICT" });
  });

  it("PB-R08 · P-08 · xoá mềm def ⇒ nguồn hết in-use (xoá nguồn ⇒ 204)", async () => {
    await mkSource(c, "Adm", gitBody("app-repo"));
    const r = await post(defWithSource("pbx-p08", "app-repo"));
    expect(r.status).toBe(201);
    expect(code(await c.call("Adm", "DELETE", "/admin/sources/app-repo?version=1")).code).toBe(
      "SOURCE_IN_USE",
    );
    expect(
      (await c.call("Adm", "DELETE", `/process-defs/${r.json.id}?version=${r.json.version}`))
        .status,
    ).toBe(204);
    expect((await c.call("Adm", "DELETE", "/admin/sources/app-repo?version=1")).status).toBe(204);
  });

  it("HUB-FR-121 · R-C26 · P-09 · def P-a không nguồn vẫn tạo bình thường, sources/inputs mặc định []", async () => {
    const r = await post(
      defInput({ key: "pbx-p09", stages: [stageDef({ key: "doc", after: { kind: "auto" } })] }),
    );
    expect(r.status).toBe(201);
    const got = await getDef(r.json.id);
    expect(got.json.sources).toEqual([]);
    expect(got.json.inputs).toEqual([]);
    expect(got.json.stages[0].sources ?? []).toEqual([]);
    expect(got.json.stages[0].must_know ?? []).toEqual([]);
  });
});
