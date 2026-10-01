// ADM-FR-20, ADM-BR-06, ADM-BR-10, AC-A06 · API /admin/commands: đọc, danh sách, version hai phía, tham số, xoá,
// nhân bản (test-plan C; M2-R15, R25, R26). Tạo/validate/tên/workflow/feature: commands.int.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  CommandListResponseSchema,
  CommandSchema,
  FeatureDetailSchema,
  versionConflictDetailsSchema,
} from "@ai/contracts";
import { ALL_CATALOG, ID, LEAK_1, leakForms } from "./_data";
import { apiSecret, createM2Env, expectErr, type Json, type M2Env, type Res } from "./_fixtures";

let env: M2Env;
beforeAll(async () => {
  env = await createM2Env({ catalog: ALL_CATALOG });
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.reset(ALL_CATALOG);
});

const as = async (method: string, path: string, body?: unknown): Promise<Res> =>
  env.call(method, path, { token: await env.admin(), body });
const W = ID.workflow;
const C = ID.command;
const FULL_MAP = {
  source_text: { source: "arg", value: "text" },
  target_lang: { source: "arg", value: "lang" },
};
const ARGS = [
  { name: "lang", description: { vi: "Ngôn ngữ" } },
  { name: "text", description: { vi: "Văn bản" }, rest: true },
];
const body = (over: Record<string, unknown> = {}) => ({
  name: "dich-moi",
  description: { vi: "Dịch văn bản" },
  workflow_id: W.translate,
  args: ARGS,
  input_map: FULL_MAP,
  output: { field: "text", render: "markdown" },
  ...over,
});
const create = (over: Record<string, unknown> = {}) => as("POST", "/admin/commands", body(over));
const patch = (id: string, version: number, over: Record<string, unknown>) =>
  as("PATCH", `/admin/commands/${id}`, { version, ...over });
const featureVersion = async (id: string): Promise<number> =>
  ((await env.owner`select version from admin.features where id = ${id}`)[0] as Json).version;
const cmd = async (id: string): Promise<Json> =>
  (await env.owner`select * from admin.commands where id = ${id}`)[0] as Json;

describe("ADM-FR-20 · đọc và danh sách (M2-R26)", () => {
  it("ADM-FR-20 · M2-R26 · GET /:id đủ args, input_map, output, timeout_s, feature_ids, warnings; :id lạ/abc → 404 body giống byte", async () => {
    const c = CommandSchema.parse((await as("GET", `/admin/commands/${C.dich}`)).json);
    expect(c).toMatchObject({
      name: "dich",
      aliases: ["tr"],
      mode: "sync",
      timeout_s: 30,
      enabled: true,
    });
    expect(c.args.map((a) => a.name)).toEqual(["lang", "text"]);
    expect(c.input_map as Json).toEqual(FULL_MAP);
    expect(c.output).toEqual({ field: "text", render: "markdown" });
    expect(c.feature_ids).toHaveLength(1);
    const a = await as("GET", `/admin/commands/${ID.unknown}`);
    const b = await as("GET", "/admin/commands/abc");
    expectErr(a, "NOT_FOUND");
    expect(a.text).toBe(b.text);
  });

  it("ADM-FR-20 · M2-R26 · list: sắp name; counts {all:5,on:3,off:2}; item có workflow {id,key,name,enabled} và features [{id,key,name,status}]", async () => {
    const body2 = CommandListResponseSchema.parse((await as("GET", "/admin/commands")).json);
    expect(body2.items.map((c) => c.name)).toEqual([
      "dich",
      "kiemtra-hoadon",
      "tom-tat",
      "tr-nhanh",
      "xuat-bao-cao",
    ]);
    expect(body2.counts).toEqual({ all: 5, on: 3, off: 2 });
    const xb = body2.items.find((c) => c.name === "xuat-bao-cao");
    expect(xb?.workflow).toMatchObject({ key: "report-export", enabled: false });
    expect(xb?.features[0]).toMatchObject({ key: "bao-cao", status: "beta" });
  });

  it("ADM-FR-20 · M2-R26 · ?status, ?feature=<uuid>, ?workflow=<uuid> lọc theo id; counts KHÔNG đổi theo ?status=; ?feature=abc → 400; ?workflow=<uuid lạ> → rỗng", async () => {
    const off = await as("GET", "/admin/commands?status=off");
    expect(off.json.items.map((c: Json) => c.name)).toEqual(["tr-nhanh", "xuat-bao-cao"]);
    expect(off.json.counts).toEqual({ all: 5, on: 3, off: 2 });
    const core = await env.coreId();
    const byFeature = await as("GET", `/admin/commands?feature=${core}`);
    expect(byFeature.json.items.map((c: Json) => c.name)).toEqual(["dich", "tom-tat"]);
    const byWorkflow = await as("GET", `/admin/commands?workflow=${W.translate}`);
    expect(byWorkflow.json.items.map((c: Json) => c.name)).toEqual(["dich", "tr-nhanh"]);
    expectErr(await as("GET", "/admin/commands?feature=abc"), "VALIDATION_ERROR");
    const none = await as("GET", `/admin/commands?workflow=${ID.unknown}`);
    expect(none.json).toMatchObject({ items: [], total: 0 });
    expectErr(await as("GET", "/admin/commands?limit=201"), "VALIDATION_ERROR");
  });

  it("ADM-FR-20 · M2-R26 · q khớp name, MỌI alias, description.vi và description.en (không phân biệt hoa thường)", async () => {
    const names = async (q: string) =>
      (await as("GET", `/admin/commands?q=${q}`)).json.items.map((c: Json) => c.name);
    expect(await names("TR")).toEqual(["dich", "kiemtra-hoadon", "tr-nhanh"]);
    expect(await names("tom-t")).toEqual(["tom-tat"]);
    await env.owner`update admin.commands set description = ${env.owner.json({ vi: "Zebra-vi-token", en: "Quick-en-token" })} where id = ${C.trNhanh}`;
    expect(await names("ZEBRA")).toEqual(["tr-nhanh"]);
    expect(await names("quick-EN")).toEqual(["tr-nhanh"]);
  });
});

describe("ADM-FR-20 · version và hai phía (M2-R25)", () => {
  it("ADM-BR-10 · M2-R25 · POST với feature_ids [core, ke-toan] → version của CẢ HAI feature tăng 1", async () => {
    const core = await env.coreId();
    const [vc, vk] = [await featureVersion(core), await featureVersion(ID.feature.keToan)];
    expect((await create({ feature_ids: [core, ID.feature.keToan] })).status).toBe(201);
    expect([await featureVersion(core), await featureVersion(ID.feature.keToan)]).toEqual([
      vc + 1,
      vk + 1,
    ]);
  });

  it("ADM-BR-10 · M2-R25 · PATCH chỉ description → feature KHÔNG đổi version; PATCH feature_ids bỏ ke-toan → ke-toan +1, core giữ", async () => {
    const core = await env.coreId();
    const made = await create({ feature_ids: [core, ID.feature.keToan] });
    const [vc, vk] = [await featureVersion(core), await featureVersion(ID.feature.keToan)];
    expect((await patch(made.json.id, 1, { description: { vi: "Mô tả khác" } })).status).toBe(200);
    expect([await featureVersion(core), await featureVersion(ID.feature.keToan)]).toEqual([vc, vk]);
    expect((await patch(made.json.id, 2, { feature_ids: [core] })).status).toBe(200);
    expect([await featureVersion(core), await featureVersion(ID.feature.keToan)]).toEqual([
      vc,
      vk + 1,
    ]);
  });

  it("ADM-BR-10 · M2-R25 · DELETE command → mọi feature chứa nó tăng version", async () => {
    const core = await env.coreId();
    const vc = await featureVersion(core);
    expect((await as("DELETE", `/admin/commands/${C.dich}`)).status).toBe(204);
    expect(await featureVersion(core)).toBe(vc + 1);
  });

  it("ADM-FR-20 · M2-R25 · version tăng với MỖI trường: name, aliases (kể cả chỉ đổi thứ tự), description, workflow_id, args, input_map, output, mode, timeout_s, enabled, tập feature", async () => {
    const core = await env.coreId();
    const made = await create({ aliases: ["a1", "a2"], feature_ids: [core] });
    let v = 1;
    const bump = async (over: Record<string, unknown>) => {
      const res = await patch(made.json.id, v, over);
      expect(res.status).toBe(200);
      expect(res.json.version).toBe(v + 1);
      v += 1;
    };
    await bump({ name: "dich-moi-2" });
    await bump({ aliases: ["a2", "a1"] });
    await bump({ description: { vi: "Mô tả mới" } });
    await bump({
      args: [ARGS[0]],
      input_map: { ...FULL_MAP, source_text: { source: "selection" } },
    });
    await bump({
      input_map: {
        source_text: { source: "selection" },
        target_lang: { source: "arg", value: "lang" },
      },
      output: { field: "text", render: "json" },
    });
    await bump({ mode: "async" });
    await bump({ timeout_s: 90 });
    await bump({ enabled: false });
    await bump({ feature_ids: [core, ID.feature.keToan] });
    await bump({
      workflow_id: W.summarize,
      args: [],
      input_map: { text: { source: "selection" } },
    });
  });

  it("ADM-FR-20 · M2-R25 · đổi thứ tự khoá input_map, cùng tập feature_ids khác thứ tự, không đổi gì → KHÔNG tăng version, updated_at giữ", async () => {
    const core = await env.coreId();
    const made = await create({ feature_ids: [core, ID.feature.keToan] });
    const reordered = { target_lang: FULL_MAP.target_lang, source_text: FULL_MAP.source_text };
    const a = await patch(made.json.id, 1, { input_map: reordered });
    const b = await patch(made.json.id, 1, { feature_ids: [ID.feature.keToan, core] });
    const c = await patch(made.json.id, 1, {});
    for (const r of [a, b, c]) {
      expect(r.status).toBe(200);
      expect(r.json.version).toBe(1);
      expect(r.json.updated_at).toBe(made.json.updated_at);
    }
  });

  it("ADM-FR-20 · M2-R25 · version cũ → 409 VERSION_CONFLICT {current: Command, updated_at}; đổi mode không tự đổi timeout_s", async () => {
    const ok = await patch(C.dich, 1, { mode: "async" });
    expect(ok.status).toBe(200);
    expect(ok.json.timeout_s).toBe(30);
    const stale = await patch(C.dich, 1, { description: { vi: "Khác" } });
    expectErr(stale, "VERSION_CONFLICT");
    const d = versionConflictDetailsSchema(CommandSchema).parse(stale.json.error.details);
    expect(d.updated_at).toBe(d.current.updated_at);
    expect(d.current.version).toBe(2);
  });

  it("ADM-BR-10 · M2-R25 · editor Feature mở trước → tạo command trong feature → lưu feature bằng version CŨ → 409 VERSION_CONFLICT (không ghi đè)", async () => {
    const feature = FeatureDetailSchema.parse(
      (await as("GET", `/admin/features/${ID.feature.keToan}`)).json,
    );
    expect((await create({ feature_ids: [ID.feature.keToan] })).status).toBe(201);
    const stale = await as("PATCH", `/admin/features/${ID.feature.keToan}`, {
      version: feature.version,
      name: { vi: "Tên khác" },
    });
    expectErr(stale, "VERSION_CONFLICT");
    const after = FeatureDetailSchema.parse(
      (await as("GET", `/admin/features/${ID.feature.keToan}`)).json,
    );
    expect(after.name).toEqual(feature.name);
    expect(after.version).toBe(feature.version + 1);
  });
});

describe("ADM-FR-20 · mode, timeout, args, output (M2-R15, M2-R16)", () => {
  it("ADM-FR-20 · M2-R15 · timeout 0/601/1.5 → 400; 1 và 600 → 201; vắng + async → 120; vắng + sync → 30", async () => {
    for (const timeout_s of [0, 601, 1.5]) {
      expectErr(await create({ name: "t-bad", timeout_s }), "VALIDATION_ERROR");
    }
    expect((await create({ name: "t-min", timeout_s: 1 })).json.timeout_s).toBe(1);
    expect((await create({ name: "t-max", timeout_s: 600 })).json.timeout_s).toBe(600);
    expect((await create({ name: "t-async", mode: "async" })).json.timeout_s).toBe(120);
    expect((await create({ name: "t-sync", mode: "sync" })).json.timeout_s).toBe(30);
    expectErr(await create({ name: "t-mode", mode: "batch" }), "VALIDATION_ERROR");
  });

  it("ADM-FR-20 · M2-R15 · args: hai rest, rest không cuối, tên trùng, 21 tham số → 400; mô tả rỗng/201, output.field thiếu, const 4001 → 400; en rỗng bỏ khoá", async () => {
    const a = (name: string, over: Record<string, unknown> = {}) => ({
      name,
      description: { vi: name },
      ...over,
    });
    for (const bad of [
      { args: [a("x1", { rest: true }), a("x2", { rest: true })] },
      { args: [a("x1", { rest: true }), a("x2")] },
      { args: [a("x1"), a("x1")] },
      { args: Array.from({ length: 21 }, (_, i) => a(`x${i}`)) },
      { description: { vi: "" } },
      { description: { vi: "x".repeat(201) } },
      { output: { render: "json" } },
      { input_map: { ...FULL_MAP, source_text: { source: "const", value: "x".repeat(4001) } } },
    ]) {
      expectErr(await create({ name: "bad-args", ...bad }), "VALIDATION_ERROR");
    }
    const ok = await create({ name: "good-args", description: { vi: "Dịch", en: "" } });
    expect(ok.status).toBe(201);
    expect(ok.json.description).toEqual({ vi: "Dịch" });
  });
});

describe("ADM-FR-20 · xoá, nhân bản, ngoài phạm vi", () => {
  it("ADM-FR-20 · M2-R26 · DELETE → 204, cascade command_names + feature_commands; GET → 404; lần 2 → 404; workflow và feature còn nguyên", async () => {
    expect((await as("DELETE", `/admin/commands/${C.dich}`)).status).toBe(204);
    for (const t of ["command_names", "feature_commands"]) {
      const r = await env.owner.unsafe(
        `select count(*)::int as n from admin.${t} where command_id = '${C.dich}'`,
      );
      expect((r[0] as Json).n).toBe(0);
    }
    expectErr(await as("GET", `/admin/commands/${C.dich}`), "NOT_FOUND");
    expectErr(await as("DELETE", `/admin/commands/${C.dich}`), "NOT_FOUND");
    expect((await as("GET", `/admin/workflows/${W.translate}`)).status).toBe(200);
    expect(
      (await as("GET", `/admin/workflows/${W.translate}/usages`)).json.commands.map(
        (c: Json) => c.name,
      ),
    ).toEqual(["tr-nhanh"]);
  });

  it("ADM-FR-20 · ui-admin 7.4 · nhân bản = GET rồi POST tên mới enabled:false → 201, aliases rỗng, bản gốc không đổi", async () => {
    const src = (await as("GET", `/admin/commands/${C.dich}`)).json;
    const copy = await as("POST", "/admin/commands", {
      name: "dich-copy",
      description: src.description,
      workflow_id: src.workflow.id,
      args: src.args,
      input_map: src.input_map,
      output: src.output,
      mode: src.mode,
      timeout_s: src.timeout_s,
      enabled: false,
      feature_ids: src.feature_ids,
    });
    expect(copy.status).toBe(201);
    expect(copy.json).toMatchObject({ enabled: false, aliases: [], name: "dich-copy" });
    expect((await cmd(C.dich)).version).toBe(src.version);
  });

  it("ADM-FR-20 · M2 không làm FR-23: POST /admin/commands/:id/test, GET …/history → 404", async () => {
    expect((await as("POST", `/admin/commands/${C.dich}/test`, {})).status).toBe(404);
    expect((await as("GET", `/admin/commands/${C.dich}/history`)).status).toBe(404);
  });

  it("AC-A06 · ADM-BR-04 · command dùng workflow trỏ secret tạo bằng API (LEAK_1): GET list/detail không chứa giá trị LEAK_1; khoá ciphertext/iv/key_version không xuất hiện ở bất kỳ đâu; đối tượng workflow không có value/secret", async () => {
    const sid = await apiSecret(env, "DIFY_CMD_LEAK", LEAK_1);
    await env.owner`update admin.workflows set secret_id = ${sid} where id = ${W.translate}`;
    const list = await as("GET", "/admin/commands");
    const detail = await as("GET", `/admin/commands/${C.dich}`);
    const keysOf = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.flatMap(keysOf)
        : v && typeof v === "object"
          ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)])
          : [];
    for (const res of [list, detail]) {
      expect(leakForms(LEAK_1).filter((f) => res.text.includes(f))).toEqual([]);
      const keys = keysOf(res.json);
      for (const k of ["ciphertext", "iv", "key_version"]) expect(keys).not.toContain(k);
    }
    // `value` hợp lệ trong input_map (nguồn arg/const) nên chỉ cấm ở cấp đối tượng workflow.
    const workflows = [...(list.json.items as Json[]).map((c) => c.workflow), detail.json.workflow];
    for (const w of workflows) {
      for (const k of ["value", "secret", "ciphertext", "iv"]) expect(w).not.toHaveProperty(k);
    }
  });
});
