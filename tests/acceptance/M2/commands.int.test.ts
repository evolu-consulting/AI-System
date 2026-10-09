// ADM-FR-20, ADM-FR-21, ADM-FR-22, ADM-BR-01, ADM-BR-02, ADM-BR-10 · API POST/PATCH /admin/commands:
// AC-A03 (phía Admin), tên/alias chung không gian tên, workflow, feature, thứ tự kiểm
// (test-plan C; M2-AC03/04/06; M2-R13…R19). Đọc/danh sách/version/xoá: commands-read.int.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { CommandSchema } from "@ai/contracts";
import { ALL_CATALOG, type CatalogParts, ID } from "./_data";
import { createM2Env, expectErr, type Json, type M2Env, type Res } from "./_fixtures";

let env: M2Env;
const NO_COMMANDS: CatalogParts = { ...ALL_CATALOG, commands: [], agents: false };
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
const names = async (cid: string): Promise<string[]> =>
  (
    await env.owner`select name from admin.command_names where command_id = ${cid} order by name`
  ).map((r) => r.name as string);
const count = async (table: string): Promise<number> =>
  ((await env.owner.unsafe(`select count(*)::int as n from admin.${table}`))[0] as Json).n;
const nameTaken = (res: Res, name: string) => {
  expectErr(res, "COMMAND_NAME_TAKEN");
  expect(res.json.error.details).toEqual({ name });
  expect(res.json.error.message).not.toContain(name);
};

describe("ADM-FR-22 · AC-A03 · validate input map khi lưu (M2-R17)", () => {
  it("ADM-FR-22 · AC-A03 · tạo /dich mà thiếu target_lang → 400 INPUT_MAP_INVALID {missing:['target_lang'], unknown:[], unknown_args:[]}, message cố định; KHÔNG lưu command/command_names", async () => {
    await env.reset(NO_COMMANDS);
    const res = await create({
      name: "dich",
      aliases: ["tr"],
      input_map: { source_text: FULL_MAP.source_text },
    });
    expectErr(res, "INPUT_MAP_INVALID");
    expect(res.json.error.details).toEqual({
      missing: ["target_lang"],
      unknown: [],
      unknown_args: [],
    });
    expect(res.json.error.message).toBe("Invalid input map");
    expect(await count("commands")).toBe(0);
    expect(await count("command_names")).toBe(0);
  });

  it("ADM-FR-20 · AC-A03 · map đủ + feature mặc định core → 201: feature_ids [core], mode sync, timeout 30, enabled, warnings []; command_names có dich và tr; /dich có trong list bật", async () => {
    await env.reset(NO_COMMANDS);
    const res = await create({ name: "dich", aliases: ["tr"] });
    expect(res.status).toBe(201);
    const c = CommandSchema.parse(res.json);
    const core = await env.coreId();
    expect(c).toMatchObject({
      name: "dich",
      aliases: ["tr"],
      feature_ids: [core],
      mode: "sync",
      timeout_s: 30,
      enabled: true,
      warnings: [],
      version: 1,
      updated_by: "admin",
    });
    expect(c.features.map((f) => f.key)).toEqual(["core"]);
    expect(c.workflow).toMatchObject({ key: "translate", enabled: true });
    expect(await names(c.id)).toEqual(["dich", "tr"]);
    const list = await as("GET", "/admin/commands?status=on");
    expect(list.json.items.map((x: Json) => x.name)).toContain("dich");
  });

  it("ADM-FR-22 · M2-R17 · khoá map không có trong workflow → unknown; arg trỏ tham số chưa khai báo → unknown_args; cả ba cùng lúc → đủ ba mảng; input không bắt buộc (tone) thiếu thì ổn", async () => {
    const unknown = await create({ input_map: { ...FULL_MAP, foo: { source: "selection" } } });
    expectErr(unknown, "INPUT_MAP_INVALID");
    expect(unknown.json.error.details).toEqual({ missing: [], unknown: ["foo"], unknown_args: [] });
    const badArg = await create({
      input_map: { ...FULL_MAP, target_lang: { source: "arg", value: "language" } },
    });
    expect(badArg.json.error.details).toEqual({
      missing: [],
      unknown: [],
      unknown_args: ["language"],
    });
    const all = await create({ input_map: { foo: { source: "arg", value: "nope" } } });
    expect(all.json.error.details).toEqual({
      missing: ["source_text", "target_lang"],
      unknown: ["foo"],
      unknown_args: ["nope"],
    });
    expect((await create({ name: "no-tone" })).status).toBe(201);
    expect(await count("commands")).toBe(6);
  });

  it("ADM-FR-22 · M2-R17 · map SAI KIỂU chỉ cảnh báo, vẫn lưu: invoice_file (file) ← selection → 201 + warnings type_mismatch; GET trả lại cùng cảnh báo", async () => {
    const res = await create({
      name: "hoa-don",
      workflow_id: W.invoiceCheck,
      args: [],
      input_map: { invoice_file: { source: "selection" } },
    });
    expect(res.status).toBe(201);
    const warning = {
      var: "invoice_file",
      type: "file",
      source: "selection",
      reason: "type_mismatch",
    };
    expect(res.json.warnings).toEqual([warning]);
    const got = await as("GET", `/admin/commands/${res.json.id}`);
    expect(got.json.warnings).toEqual([warning]);
    expect(await count("commands")).toBe(6);
  });

  it("ADM-FR-22 · M2-R17 · cảnh báo tính lại mỗi lần đọc (không lưu): đổi input_schema bằng owner → warnings đổi; const 'abc' cho number → const_invalid; PATCH vẫn nhận cảnh báo", async () => {
    await env.owner`update admin.workflows set input_schema = ${env.owner.json([
      { name: "invoice_file", type: "file", required: true, description: "File hoá đơn" },
      { name: "n", type: "number", required: false, description: "Số" },
    ])} where id = ${W.invoiceCheck}`;
    const res = await create({
      name: "hoa-don",
      workflow_id: W.invoiceCheck,
      args: [],
      input_map: { invoice_file: { source: "attachment" }, n: { source: "const", value: "abc" } },
    });
    expect(res.status).toBe(201);
    expect(res.json.warnings).toEqual([
      { var: "n", type: "number", source: "const", reason: "const_invalid" },
    ]);
    await env.owner`update admin.workflows set input_schema = ${env.owner.json([
      { name: "invoice_file", type: "file", required: true, description: "File hoá đơn" },
      { name: "n", type: "text", required: false, description: "Số" },
    ])} where id = ${W.invoiceCheck}`;
    const again = await as("GET", `/admin/commands/${res.json.id}`);
    expect(again.json.warnings).toEqual([]);
    const p = await patch(res.json.id, 1, { input_map: { invoice_file: { source: "selection" } } });
    expect(p.status).toBe(200);
    expect(p.json.warnings).toHaveLength(1);
  });
});

describe("ADM-BR-01 · tên và alias chung không gian tên (M2-AC03, M2-R13)", () => {
  it("ADM-BR-01 · M2-AC03 · bốn hướng trùng → 409 COMMAND_NAME_TAKEN {name}: tên↔tên, tên↔alias, alias↔tên, alias↔alias; message cố định không chứa tên", async () => {
    nameTaken(await create({ name: "dich" }), "dich");
    nameTaken(await create({ name: "tr" }), "tr");
    nameTaken(await create({ name: "moi-ok", aliases: ["dich"] }), "dich");
    nameTaken(await create({ name: "moi-ok", aliases: ["tr"] }), "tr");
    expect(await count("commands")).toBe(5);
  });

  it("ADM-BR-01 · M2-R13 · details.name = tên/alias ĐẦU TIÊN bị trùng theo thứ tự [name, ...aliases]", async () => {
    nameTaken(await create({ name: "moi-ok", aliases: ["tr", "dich"] }), "tr");
    nameTaken(await create({ name: "moi-ok", aliases: ["alias-ok", "dich"] }), "dich");
  });

  it("ADM-BR-01 · M2-R13 · name trùng alias của chính nó, 6 alias, alias trùng nhau, tên không hợp lệ → 400 VALIDATION_ERROR; chuẩn hoá '  DICH-2 ' → dich-2", async () => {
    for (const over of [
      { name: "tr-2", aliases: ["tr-2"] },
      { aliases: ["a1", "a2", "a3", "a4", "a5", "a6"] },
      { aliases: ["x1", "x1"] },
      { name: "d" },
      { name: "a_b" },
      { name: "có-dấu" },
      { name: "x".repeat(33) },
      { aliases: ["Bad_Alias"] },
    ]) {
      expectErr(await create(over), "VALIDATION_ERROR");
    }
    const ok = await create({ name: "  DICH-2 ", aliases: ["A1", "a2", "a3", "a4", "a5"] });
    expect(ok.status).toBe(201);
    expect(ok.json.name).toBe("dich-2");
    expect(ok.json.aliases).toEqual(["a1", "a2", "a3", "a4", "a5"]);
  });

  it("ADM-BR-01 · M2-R13 · PATCH đổi alias giải phóng tên cũ và đồng bộ command_names; tạo command khác dùng tên cũ được ngay", async () => {
    const res = await patch(ID.command.dich, 1, { aliases: ["tr2"] });
    expect(res.status).toBe(200);
    expect(await names(ID.command.dich)).toEqual(["dich", "tr2"]);
    expect((await create({ name: "tr" })).status).toBe(201);
  });

  it("ADM-BR-01 · M2-R13 · PATCH trùng giữa chừng → 409 và command_names KHÔNG đổi (một transaction); PATCH về chính tên mình không tự xung đột", async () => {
    const before = await names(ID.command.dich);
    nameTaken(await patch(ID.command.dich, 1, { aliases: ["tr3", "tom-tat"] }), "tom-tat");
    expect(await names(ID.command.dich)).toEqual(before);
    expect(
      (
        (
          await env.owner`select aliases from admin.commands where id = ${ID.command.dich}`
        )[0] as Json
      ).aliases,
    ).toEqual(["tr"]);
    const same = await patch(ID.command.dich, 1, {
      name: "dich",
      aliases: ["tr"],
      description: { vi: "Mô tả mới" },
    });
    expect(same.status).toBe(200);
  });

  it("ADM-BR-01 · M2-R13 · đổi name giải phóng tên cũ; DELETE giải phóng cả tên và alias", async () => {
    expect((await patch(ID.command.dich, 1, { name: "dich-3" })).status).toBe(200);
    expect(await names(ID.command.dich)).toEqual(["dich-3", "tr"]);
    expect((await create({ name: "dich" })).status).toBe(201);
    expect((await as("DELETE", `/admin/commands/${ID.command.dich}`)).status).toBe(204);
    expect((await create({ name: "tr" })).status).toBe(201);
    expect((await create({ name: "dich-3" })).status).toBe(201);
  });
});

describe("ADM-BR-02 · workflow của command (M2-R14, M2-AC06)", () => {
  it("ADM-BR-02 · M2-R14 · workflow_id lạ → 400 INVALID_REFERENCE {field:'workflow_id'}; thiếu → 400 VALIDATION_ERROR; không phải uuid → 400", async () => {
    const res = await create({ workflow_id: ID.unknown });
    expectErr(res, "INVALID_REFERENCE");
    expect(res.json.error.details).toEqual({ field: "workflow_id", ids: [ID.unknown] });
    const { workflow_id: _w, ...rest } = body();
    expectErr(await as("POST", "/admin/commands", rest), "VALIDATION_ERROR");
    expectErr(await create({ workflow_id: "abc" }), "VALIDATION_ERROR");
  });

  it("ADM-BR-02 · M2-R18 · đổi workflow (kèm map phù hợp) → 200 và command trỏ workflow mới; nhiều command dùng chung một workflow", async () => {
    const res = await patch(ID.command.tomTat, 1, {
      workflow_id: W.translate,
      input_map: FULL_MAP,
      args: ARGS,
    });
    expect(res.status).toBe(200);
    expect(res.json.workflow.key).toBe("translate");
    const shared =
      await env.owner`select count(*)::int as n from admin.commands where workflow_id = ${W.translate}`;
    expect(shared[0]?.n).toBe(3);
  });

  it("ADM-BR-02 · M2-AC06 · workflow TẮT: POST enabled:true → 409 WORKFLOW_DISABLED {workflow:{id,key}}; enabled:false → 201", async () => {
    const res = await create({
      name: "xuat-2",
      workflow_id: W.reportExport,
      args: [],
      input_map: {},
      enabled: true,
    });
    expectErr(res, "WORKFLOW_DISABLED");
    expect(res.json.error.details).toEqual({
      workflow: { id: W.reportExport, key: "report-export" },
    });
    const off = await create({
      name: "xuat-3",
      workflow_id: W.reportExport,
      args: [],
      input_map: {},
      enabled: false,
    });
    expect(off.status).toBe(201);
    expect(off.json.enabled).toBe(false);
  });

  it("ADM-BR-02 · M2-AC06 · PATCH enabled:true khi workflow tắt → 409; command TẮT sửa mô tả khi workflow tắt → 200; bật workflow lại → bật command được", async () => {
    const id = ID.command.xuatBaoCao;
    expectErr(await patch(id, 1, { enabled: true }), "WORKFLOW_DISABLED");
    const edit = await patch(id, 1, { description: { vi: "Xuất báo cáo tháng" } });
    expect(edit.status).toBe(200);
    await env.owner`update admin.workflows set enabled = true where id = ${W.reportExport}`;
    expect((await patch(id, 2, { enabled: true })).status).toBe(200);
  });
});

describe("ADM-BR-10 · feature của command (M2-R19; CR-055 bỏ luật ≥ 1 feature)", () => {
  it("CR-055 · ADM-BR-10 · feature_ids [] → 201 command chưa gắn feature (feature_ids [], features []); PATCH [] → 200 và DB không còn hàng feature_commands", async () => {
    const res = await create({ feature_ids: [] });
    expect(res.status).toBe(201);
    expect(res.json.feature_ids).toEqual([]);
    expect(res.json.features).toEqual([]);
    expect(await count("commands")).toBe(6);
    const p = await patch(ID.command.dich, 1, { feature_ids: [] });
    expect(p.status).toBe(200);
    expect(p.json.feature_ids).toEqual([]);
    const rows =
      await env.owner`select count(*)::int as n from admin.feature_commands where command_id = ${ID.command.dich}`;
    expect(rows[0]?.n).toBe(0);
  });

  it("ADM-BR-10 · M2-R19 · feature_ids có uuid lạ → 400 INVALID_REFERENCE {field:'feature_ids'}; trùng → VALIDATION_ERROR", async () => {
    const res = await create({ feature_ids: [ID.unknown] });
    expectErr(res, "INVALID_REFERENCE");
    expect(res.json.error.details).toEqual({ field: "feature_ids", ids: [ID.unknown] });
    expectErr(
      await create({ feature_ids: [ID.feature.keToan, ID.feature.keToan] }),
      "VALIDATION_ERROR",
    );
  });

  it("ADM-BR-10 · M2-R19 · hai feature (core, ke-toan) → features core đầu; bỏ ke-toan còn core → ok; feature off vẫn gán được và không đổi enabled", async () => {
    const core = await env.coreId();
    const res = await create({ feature_ids: [ID.feature.keToan, core, ID.feature.thuNghiem] });
    expect(res.status).toBe(201);
    expect(res.json.features.map((f: Json) => f.key)).toEqual(["core", "ke-toan", "thu-nghiem"]);
    expect(res.json.features.find((f: Json) => f.key === "thu-nghiem").status).toBe("off");
    expect(res.json.enabled).toBe(true);
    const drop = await patch(res.json.id, 1, { feature_ids: [core] });
    expect(drop.status).toBe(200);
    expect(drop.json.feature_ids).toEqual([core]);
  });
});

describe("ADM-FR-20 · thứ tự kiểm (spec §3)", () => {
  it("ADM-FR-20 · spec §3 · POST nhiều lỗi cùng lúc: INVALID_REFERENCE (workflow rồi feature) → COMMAND_NAME_TAKEN → INPUT_MAP_INVALID → WORKFLOW_DISABLED (CR-055: feature_ids [] không còn là lỗi)", async () => {
    const empty = await create({ feature_ids: [], workflow_id: ID.unknown });
    expectErr(empty, "INVALID_REFERENCE");
    expect(empty.json.error.details.field).toBe("workflow_id");
    const wf = await create({ name: "dich", workflow_id: ID.unknown, feature_ids: [ID.unknown] });
    expectErr(wf, "INVALID_REFERENCE");
    expect(wf.json.error.details.field).toBe("workflow_id");
    const ft = await create({ name: "dich", feature_ids: [ID.unknown] });
    expectErr(ft, "INVALID_REFERENCE");
    expect(ft.json.error.details.field).toBe("feature_ids");
    expectErr(await create({ name: "dich", input_map: {} }), "COMMAND_NAME_TAKEN");
    expectErr(
      await create({
        name: "xuat-2",
        workflow_id: W.reportExport,
        input_map: { foo: { source: "selection" } },
      }),
      "INPUT_MAP_INVALID",
    );
    expectErr(
      await create({
        name: "xuat-2",
        workflow_id: W.reportExport,
        args: [],
        input_map: {},
        enabled: true,
      }),
      "WORKFLOW_DISABLED",
    );
  });

  it("ADM-FR-20 · spec §3 · PATCH: body sai + :id lạ → VALIDATION_ERROR; :id lạ + body đúng → 404; version cũ + vi phạm luật → VERSION_CONFLICT; không đổi gì → 200 dù workflow đang tắt", async () => {
    expectErr(
      await as("PATCH", `/admin/commands/${ID.unknown}`, { version: 0 }),
      "VALIDATION_ERROR",
    );
    expectErr(await patch(ID.unknown, 1, { description: { vi: "x" } }), "NOT_FOUND");
    expectErr(await patch(ID.command.dich, 9, { feature_ids: [] }), "VERSION_CONFLICT");
    const cur = (await as("GET", `/admin/commands/${ID.command.xuatBaoCao}`)).json;
    const same = await patch(ID.command.xuatBaoCao, cur.version, { enabled: false });
    expect(same.status).toBe(200);
    expect(same.json.version).toBe(cur.version);
  });
});
