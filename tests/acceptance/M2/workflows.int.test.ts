// ADM-FR-10, ADM-FR-11, ADM-FR-13, ADM-FR-14, ADM-FR-15, ADM-BR-06, ADM-BR-13 · API /admin/workflows
// (test-plan W; AC-A05, AC-A13, M2-AC06/07/08; M2-R07…R12, R18, R25). Command, agent, secret dựng bằng owner SQL.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  versionConflictDetailsSchema,
  WorkflowListResponseSchema,
  WorkflowSchema,
  WorkflowUsagesSchema,
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
const desc = (n: number) => "d".repeat(n);
const newWf = (over: Record<string, unknown> = {}) => ({
  key: "translate-2",
  name: "Translate 2",
  description: desc(40),
  app_type: "workflow",
  base_url: "https://dify.example.com/v1",
  secret_id: ID.secret.translate,
  ...over,
});
const param = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  type: "text",
  required: false,
  description: `Tham số ${name}`,
  ...over,
});
const patch = (id: string, version: number, body: Record<string, unknown>) =>
  as("PATCH", `/admin/workflows/${id}`, { version, ...body });
const version = async (id: string): Promise<number> =>
  ((await env.owner`select version from admin.workflows where id = ${id}`)[0] as Json).version;
const wfRow = async (id: string) =>
  (await env.owner`select * from admin.workflows where id = ${id}`)[0] as Json | undefined;
const TRANSLATE_SCHEMA = [
  param("source_text", { required: true }),
  param("target_lang", { required: true }),
  param("tone", { type: "select", options: ["formal", "casual"] }),
];

describe("ADM-FR-10 · tạo workflow (POST)", () => {
  it("ADM-FR-10 · M2-R07 · POST đầy đủ → 201 WorkflowSchema: enabled, unattached, counts 0, secret {id,name}, updated_by, version 1", async () => {
    const res = await as(
      "POST",
      "/admin/workflows",
      newWf({ input_schema: TRANSLATE_SCHEMA, output_field: "text" }),
    );
    expect(res.status).toBe(201);
    const w = WorkflowSchema.parse(res.json);
    expect(w).toMatchObject({
      key: "translate-2",
      enabled: true,
      unattached: true,
      command_count: 0,
      agent_count: 0,
      secret: { id: ID.secret.translate, name: "DIFY_TRANSLATE_KEY" },
      output_field: "text",
      updated_by: "admin",
      version: 1,
    });
    expect(w.input_schema).toHaveLength(3);
    expect(w.input_schema[2]?.options).toEqual(["formal", "casual"]);
  });

  it("ADM-FR-10 · M2-AC07 · mô tả 19 → 400; 20 → 201; 400 → 201; 401 → 400; đếm sau trim", async () => {
    expectErr(
      await as("POST", "/admin/workflows", newWf({ description: desc(19) })),
      "VALIDATION_ERROR",
    );
    expect(
      (await as("POST", "/admin/workflows", newWf({ key: "d-20", description: desc(20) }))).status,
    ).toBe(201);
    expect(
      (await as("POST", "/admin/workflows", newWf({ key: "d-400", description: desc(400) })))
        .status,
    ).toBe(201);
    expectErr(
      await as("POST", "/admin/workflows", newWf({ key: "d-401", description: desc(401) })),
      "VALIDATION_ERROR",
    );
    expectErr(
      await as("POST", "/admin/workflows", newWf({ key: "d-pad", description: `  ${desc(19)}  ` })),
      "VALIDATION_ERROR",
    );
    const padded = await as(
      "POST",
      "/admin/workflows",
      newWf({ key: "d-pad2", description: `  ${desc(20)}  ` }),
    );
    expect(padded.status).toBe(201);
    expect(padded.json.description).toBe(desc(20));
  });

  it("ADM-FR-11 · M2-AC07 · M2-R08 · tham số thiếu mô tả → 400 (path input_schema.0.description); select thiếu options, options ở kiểu text, tên trùng, 51 tham số, tên a-b → 400", async () => {
    const bad = await as(
      "POST",
      "/admin/workflows",
      newWf({ input_schema: [param("a", { description: "" })] }),
    );
    expectErr(bad, "VALIDATION_ERROR");
    expect(bad.json.error.details.issues[0].path).toEqual(["input_schema", 0, "description"]);
    for (const input_schema of [
      [param("a", { type: "select" })],
      [param("a", { options: ["x"] })],
      [param("a"), param("a")],
      Array.from({ length: 51 }, (_, i) => param(`p${i}`)),
      [param("a-b")],
    ]) {
      expectErr(await as("POST", "/admin/workflows", newWf({ input_schema })), "VALIDATION_ERROR");
    }
    expect(
      (
        await as(
          "POST",
          "/admin/workflows",
          newWf({
            key: "fifty",
            input_schema: Array.from({ length: 50 }, (_, i) => param(`p${i}`)),
          }),
        )
      ).status,
    ).toBe(201);
  });

  it("ADM-FR-10 · M2-R07 · key sai/trùng (kể cả TRANSLATE viết hoa) → 400 / 409 KEY_TAKEN 'Key is already taken'; base_url ftp:// hoặc có userinfo → 400; app_type lạ → 400", async () => {
    expectErr(await as("POST", "/admin/workflows", newWf({ key: "A_b" })), "VALIDATION_ERROR");
    const dup = await as("POST", "/admin/workflows", newWf({ key: "TRANSLATE" }));
    expectErr(dup, "KEY_TAKEN");
    expect(dup.json.error.message).toBe("Key is already taken");
    for (const base_url of ["ftp://x.com", "https://u:p@x.com", "dify.example.com"]) {
      expectErr(await as("POST", "/admin/workflows", newWf({ base_url })), "VALIDATION_ERROR");
    }
    expectErr(await as("POST", "/admin/workflows", newWf({ app_type: "bot" })), "VALIDATION_ERROR");
  });

  it("ADM-FR-10 · M2-R07 · secret_id không tồn tại → 400 INVALID_REFERENCE {field:'secret_id', ids} và KHÔNG tạo; không phải uuid / thiếu → 400 VALIDATION_ERROR", async () => {
    const res = await as("POST", "/admin/workflows", newWf({ secret_id: ID.unknown }));
    expectErr(res, "INVALID_REFERENCE");
    expect(res.json.error.details).toEqual({ field: "secret_id", ids: [ID.unknown] });
    expect((await env.owner`select 1 from admin.workflows where key = 'translate-2'`).length).toBe(
      0,
    );
    expectErr(
      await as("POST", "/admin/workflows", newWf({ secret_id: "abc" })),
      "VALIDATION_ERROR",
    );
    const { secret_id: _omit, ...rest } = newWf();
    expectErr(await as("POST", "/admin/workflows", rest), "VALIDATION_ERROR");
  });
});

describe("ADM-FR-14 · Chưa gắn (AC-A13, M2-R09)", () => {
  it("ADM-FR-14 · AC-A13 · report-tax (không command, không agent): unattached true; usages rỗng; không có route cấp quyền (BR-13)", async () => {
    const w = WorkflowSchema.parse((await as("GET", `/admin/workflows/${W.reportTax}`)).json);
    expect(w).toMatchObject({ unattached: true, command_count: 0, agent_count: 0 });
    const u = WorkflowUsagesSchema.parse(
      (await as("GET", `/admin/workflows/${W.reportTax}/usages`)).json,
    );
    expect(u).toMatchObject({ commands: [], agents: [], command_count: 0, agent_count: 0 });
    expect((await as("POST", `/admin/workflows/${W.reportTax}/grants`, {})).status).toBe(404);
    expect((await as("PUT", `/admin/workflows/${W.reportTax}/access`, {})).status).toBe(404);
  });

  it("ADM-FR-14 · M2-R09 · ?attached=false chỉ có report-tax; ?attached=true có 4 workflow còn lại; counts.unattached = 1 và KHÔNG đổi theo bộ lọc", async () => {
    const no = await as("GET", "/admin/workflows?attached=false");
    expect(no.json.items.map((w: Json) => w.key)).toEqual(["report-tax"]);
    expect(no.json.counts.unattached).toBe(1);
    const yes = await as("GET", "/admin/workflows?attached=true");
    expect(yes.json.items.map((w: Json) => w.key)).toEqual([
      "invoice-check",
      "report-export",
      "summarize",
      "translate",
    ]);
    expect(yes.json.counts).toEqual(no.json.counts);
    expectErr(await as("GET", "/admin/workflows?attached=1"), "VALIDATION_ERROR");
  });

  it("ADM-FR-14 · M2-R09 · workflow chỉ có command TẮT (report-export) vẫn attached; workflow chỉ có agent attached", async () => {
    const exp = (await as("GET", `/admin/workflows/${W.reportExport}`)).json;
    expect(exp).toMatchObject({ command_count: 1, unattached: false });
    await env.owner`insert into hub.agent_workflows (agent_id, workflow_id)
      values ('01900000-0000-7000-8000-0000000002a2', ${W.reportTax})`;
    const tax = (await as("GET", `/admin/workflows/${W.reportTax}`)).json;
    expect(tax).toMatchObject({ command_count: 0, agent_count: 1, unattached: false });
  });
});

describe("ADM-FR-15 · usages và danh sách", () => {
  it("ADM-FR-15 · M2-R10 · usages translate: commands sắp name [dich bật, tr-nhanh tắt], agents [{id}], count và agents_available", async () => {
    const res = await as("GET", `/admin/workflows/${W.translate}/usages`);
    const u = WorkflowUsagesSchema.parse(res.json);
    expect(u.commands).toEqual([
      { id: ID.command.dich, name: "dich", enabled: true },
      { id: ID.command.trNhanh, name: "tr-nhanh", enabled: false },
    ]);
    expect(u.agents).toEqual([{ id: ID.agent }]);
    expect([u.command_count, u.agent_count, u.agents_available]).toEqual([2, 1, true]);
  });

  it("ADM-FR-15 · M2-R26 · list: sắp key; counts {all:5,on:4,off:1,unattached:1}; command_count/agent_count đúng; item parse strict", async () => {
    const body = WorkflowListResponseSchema.parse((await as("GET", "/admin/workflows")).json);
    expect(body.items.map((w) => w.key)).toEqual([
      "invoice-check",
      "report-export",
      "report-tax",
      "summarize",
      "translate",
    ]);
    expect(body.counts).toEqual({ all: 5, on: 4, off: 1, unattached: 1 });
    const tr = body.items.find((w) => w.key === "translate");
    expect([tr?.command_count, tr?.agent_count, tr?.unattached]).toEqual([2, 1, false]);
    expect(body.items.find((w) => w.key === "report-export")?.enabled).toBe(false);
  });

  it("ADM-FR-15 · M2-R26 · ?status=off, ?secret= (viết thường cũng khớp; lạ → rỗng), q, limit=201 → 400", async () => {
    const off = await as("GET", "/admin/workflows?status=off");
    expect(off.json.items.map((w: Json) => w.key)).toEqual(["report-export"]);
    expect(off.json.counts).toEqual({ all: 5, on: 4, off: 1, unattached: 1 });
    const sec = await as("GET", "/admin/workflows?secret=dify_translate_key");
    expect(sec.json.items.map((w: Json) => w.key)).toEqual(["translate"]);
    const none = await as("GET", "/admin/workflows?secret=KHONG_CO");
    expect(none.json).toMatchObject({ items: [], total: 0 });
    expect((await as("GET", "/admin/workflows?q=REPORT")).json.items).toHaveLength(2);
    expectErr(await as("GET", "/admin/workflows?limit=201"), "VALIDATION_ERROR");
    expectErr(await as("GET", "/admin/workflows?status=unattached"), "VALIDATION_ERROR");
  });

  it("ADM-FR-10 · M2-R26 · GET /:id → Workflow đủ base_url/input_schema/output_field/created_at; :id lạ hoặc abc → 404 body giống byte", async () => {
    const w = WorkflowSchema.parse((await as("GET", `/admin/workflows/${W.translate}`)).json);
    expect(w).toMatchObject({ base_url: "https://dify.example.com/v1", output_field: "text" });
    expect(w.input_schema.map((p) => p.name)).toEqual(["source_text", "target_lang", "tone"]);
    const a = await as("GET", `/admin/workflows/${ID.unknown}`);
    const b = await as("GET", "/admin/workflows/abc");
    expectErr(a, "NOT_FOUND");
    expect(a.text).toBe(b.text);
    expectErr(await as("GET", `/admin/workflows/${ID.unknown}/usages`), "NOT_FOUND");
  });
});

describe("ADM-FR-13 · chặn xoá (AC-A05, M2-R11)", () => {
  it("ADM-FR-13 · AC-A05 · DELETE translate (command dich + agent …02a1) → 409 WORKFLOW_IN_USE {action:'delete'} liệt kê CẢ command và agent; workflow còn nguyên", async () => {
    const res = await as("DELETE", `/admin/workflows/${W.translate}`);
    expectErr(res, "WORKFLOW_IN_USE");
    expect(res.json.error.details).toEqual({
      action: "delete",
      commands: [
        { id: ID.command.dich, name: "dich", enabled: true },
        { id: ID.command.trNhanh, name: "tr-nhanh", enabled: false },
      ],
      agents: [{ id: ID.agent }],
    });
    expect(await wfRow(W.translate)).toBeDefined();
  });

  it("ADM-FR-13 · M2-R11 · chỉ có command TẮT (report-export) vẫn chặn xoá; không dùng (report-tax) → 204, xoá thật", async () => {
    const blocked = await as("DELETE", `/admin/workflows/${W.reportExport}`);
    expectErr(blocked, "WORKFLOW_IN_USE");
    expect(blocked.json.error.details.commands).toEqual([
      { id: ID.command.xuatBaoCao, name: "xuat-bao-cao", enabled: false },
    ]);
    expect((await as("DELETE", `/admin/workflows/${W.reportTax}`)).status).toBe(204);
    expect(await wfRow(W.reportTax)).toBeUndefined();
    expectErr(await as("GET", `/admin/workflows/${W.reportTax}`), "NOT_FOUND");
    expectErr(await as("DELETE", `/admin/workflows/${ID.unknown}`), "NOT_FOUND");
  });

  it("ADM-FR-13 · M2-R11 · chỉ có agent → chặn xoá; xoá hết command và agent → xoá được", async () => {
    await env.owner`delete from admin.commands where workflow_id = ${W.translate}`;
    expectErr(await as("DELETE", `/admin/workflows/${W.translate}`), "WORKFLOW_IN_USE");
    await env.owner`delete from hub.agent_workflows`;
    expect((await as("DELETE", `/admin/workflows/${W.translate}`)).status).toBe(204);
  });
});

describe("ADM-FR-13 · chặn tắt (AC-A05, M2-AC06, M2-R11)", () => {
  it("ADM-FR-13 · M2-AC06 · tắt translate khi còn command BẬT/agent → 409 {action:'disable'} chỉ command đang bật + mọi agent", async () => {
    const res = await patch(W.translate, 1, { enabled: false });
    expectErr(res, "WORKFLOW_IN_USE");
    expect(res.json.error.details).toEqual({
      action: "disable",
      commands: [{ id: ID.command.dich, name: "dich", enabled: true }],
      agents: [{ id: ID.agent }],
    });
    expect((await wfRow(W.translate))?.enabled).toBe(true);
  });

  it("ADM-FR-13 · M2-AC06 · tắt command trước rồi tắt workflow → 200; bật lại luôn 200", async () => {
    expectErr(await patch(W.invoiceCheck, 1, { enabled: false }), "WORKFLOW_IN_USE");
    await env.owner`update admin.commands set enabled = false where id = ${ID.command.kiemtraHoadon}`;
    const off = await patch(W.invoiceCheck, 1, { enabled: false });
    expect(off.status).toBe(200);
    expect(off.json.enabled).toBe(false);
    const on = await patch(W.invoiceCheck, 2, { enabled: true });
    expect(on.status).toBe(200);
  });

  it("ADM-FR-13 · M2-R11 · command đều tắt nhưng còn agent → vẫn 409 disable (commands rỗng, agents đủ)", async () => {
    await env.owner`update admin.commands set enabled = false where workflow_id = ${W.translate}`;
    const res = await patch(W.translate, 1, { enabled: false });
    expectErr(res, "WORKFLOW_IN_USE");
    expect(res.json.error.details).toEqual({
      action: "disable",
      commands: [],
      agents: [{ id: ID.agent }],
    });
  });

  it("ADM-BR-06 · M2-R11 · tắt workflow (không command/agent) → 200; hàng vẫn còn, GET được, command trỏ vào giữ nguyên", async () => {
    await env.owner`update admin.commands set enabled = false where id = ${ID.command.tomTat}`;
    expect((await patch(W.summarize, 1, { enabled: false })).status).toBe(200);
    const w = (await as("GET", `/admin/workflows/${W.summarize}`)).json;
    expect(w.enabled).toBe(false);
    const [c] =
      await env.owner`select workflow_id, enabled from admin.commands where id = ${ID.command.tomTat}`;
    expect(c).toMatchObject({ workflow_id: W.summarize, enabled: false });
  });

  it("ADM-FR-13 · M2-R11 · thứ tự kiểm PATCH: INVALID_REFERENCE → WORKFLOW_IN_USE → SCHEMA_BREAKS_COMMANDS", async () => {
    expectErr(
      await patch(W.translate, 1, { secret_id: ID.unknown, enabled: false }),
      "INVALID_REFERENCE",
    );
    const breaking = [param("source_text", { required: true })];
    expectErr(
      await patch(W.translate, 1, { enabled: false, input_schema: breaking }),
      "WORKFLOW_IN_USE",
    );
    expectErr(await patch(W.translate, 1, { input_schema: breaking }), "SCHEMA_BREAKS_COMMANDS");
  });
});

describe("ADM-FR-15 · hub.agent_workflows vắng/không đọc được (M2-R12, A5)", () => {
  const AGENT_TABLE = "hub.agent_workflows";
  const restore = async () => {
    await env.owner.unsafe(
      "alter table if exists hub.agent_workflows_qc rename to agent_workflows",
    );
    await env.owner.unsafe("grant select on hub.agent_workflows to admin_rw");
  };
  afterAll(async () => {
    await restore();
    const [r] = await env.owner`select to_regclass('hub.agent_workflows') as t,
      has_table_privilege('admin_rw', 'hub.agent_workflows', 'SELECT') as p`;
    expect(r).toMatchObject({ t: "agent_workflows", p: true });
  });

  async function expectNoAgents(): Promise<void> {
    const u = WorkflowUsagesSchema.parse(
      (await as("GET", `/admin/workflows/${W.translate}/usages`)).json,
    );
    expect(u).toMatchObject({
      agents: [],
      agent_count: 0,
      agents_available: false,
      command_count: 2,
    });
    const list = await as("GET", "/admin/workflows");
    expect(list.status).toBe(200);
    const tr = list.json.items.find((w: Json) => w.key === "translate");
    expect(tr).toMatchObject({ agent_count: 0, command_count: 2, unattached: false });
    expect(
      (await as("PATCH", `/admin/workflows/${W.reportTax}`, { version: 1, enabled: false })).status,
    ).toBe(200);
    expect((await as("DELETE", `/admin/workflows/${W.reportTax}`)).status).toBe(204);
  }

  it("ADM-FR-15 · M2-R12 · bảng hub.agent_workflows KHÔNG tồn tại (to_regclass NULL): agents=[], agent_count=0, agents_available=false, không 500; list/xoá/tắt vẫn chạy", async () => {
    try {
      await env.owner.unsafe("alter table hub.agent_workflows rename to agent_workflows_qc");
      await expectNoAgents();
    } finally {
      await restore();
    }
  });

  it("ADM-FR-15 · M2-R12 · bảng còn nhưng admin_rw bị REVOKE SELECT → như trên (không 500)", async () => {
    try {
      await env.owner.unsafe(`revoke select on ${AGENT_TABLE} from admin_rw`);
      await expectNoAgents();
    } finally {
      await restore();
    }
  });

  it("ADM-FR-15 · M2-R12 · không cache: đổi trạng thái giữa các request liên tiếp thì kết quả đổi theo (có → vắng → có)", async () => {
    const url = `/admin/workflows/${W.translate}/usages`;
    expect((await as("GET", url)).json.agents_available).toBe(true);
    try {
      await env.owner.unsafe("alter table hub.agent_workflows rename to agent_workflows_qc");
      expect((await as("GET", url)).json.agents_available).toBe(false);
    } finally {
      await restore();
    }
    const back = (await as("GET", url)).json;
    expect(back.agents_available).toBe(true);
    expect(back.agents).toEqual([{ id: ID.agent }]);
  });
});

describe("ADM-FR-22 · SCHEMA_BREAKS_COMMANDS (M2-AC08, M2-R18)", () => {
  const broken = (res: Res) => res.json.error.details.commands;

  it("ADM-FR-22 · M2-AC08 · xoá target_lang đang được map → 409 liệt kê dich và tr-nhanh (cả command tắt) sắp name; DB và version không đổi", async () => {
    const res = await patch(W.translate, 1, {
      input_schema: [TRANSLATE_SCHEMA[0], TRANSLATE_SCHEMA[2]],
    });
    expectErr(res, "SCHEMA_BREAKS_COMMANDS");
    expect(broken(res)).toEqual([
      { id: ID.command.dich, name: "dich", missing: [], unknown: ["target_lang"] },
      { id: ID.command.trNhanh, name: "tr-nhanh", missing: [], unknown: ["target_lang"] },
    ]);
    expect(await version(W.translate)).toBe(1);
    expect(((await wfRow(W.translate))?.input_schema as Json[] | undefined)?.length).toBe(3);
  });

  it("ADM-FR-22 · M2-AC08 · đổi tên target_lang→lang → missing [lang] + unknown [target_lang]; thêm biến BẮT BUỘC chưa map → missing [style]", async () => {
    const renamed = await patch(W.translate, 1, {
      input_schema: [TRANSLATE_SCHEMA[0], param("lang", { required: true }), TRANSLATE_SCHEMA[2]],
    });
    expectErr(renamed, "SCHEMA_BREAKS_COMMANDS");
    expect(broken(renamed)[0]).toMatchObject({
      name: "dich",
      missing: ["lang"],
      unknown: ["target_lang"],
    });
    const added = await patch(W.translate, 1, {
      input_schema: [...TRANSLATE_SCHEMA, param("style", { required: true })],
    });
    expectErr(added, "SCHEMA_BREAKS_COMMANDS");
    expect(broken(added)[0]).toMatchObject({ name: "dich", missing: ["style"], unknown: [] });
  });

  it("ADM-FR-22 · M2-R18 · thêm biến KHÔNG bắt buộc, đổi type/description của biến đang map → 200; workflow không có command → mọi schema đều được", async () => {
    const optional = await patch(W.translate, 1, {
      input_schema: [...TRANSLATE_SCHEMA, param("extra")],
    });
    expect(optional.status).toBe(200);
    const retyped = await patch(W.translate, 2, {
      input_schema: [
        { ...TRANSLATE_SCHEMA[0], description: "Văn bản nguồn" },
        { ...TRANSLATE_SCHEMA[1], type: "select", options: ["vi", "en"] },
        TRANSLATE_SCHEMA[2],
        param("extra"),
      ],
    });
    expect(retyped.status).toBe(200);
    expect(
      (await patch(W.reportTax, 1, { input_schema: [param("anything", { required: true })] }))
        .status,
    ).toBe(200);
  });
});

describe("ADM-FR-10 · PATCH và version (M2-R25)", () => {
  it("ADM-FR-10 · M2-R25 · version cũ → 409 VERSION_CONFLICT {current: Workflow, updated_at}; không đổi gì → 200 không tăng version; key/thiếu version → 400", async () => {
    expect((await patch(W.reportTax, 1, { name: "Tax 2" })).json.version).toBe(2);
    const stale = await patch(W.reportTax, 1, { name: "Tax 3" });
    expectErr(stale, "VERSION_CONFLICT");
    const d = versionConflictDetailsSchema(WorkflowSchema).parse(stale.json.error.details);
    expect(d.updated_at).toBe(d.current.updated_at);
    const before = (await as("GET", `/admin/workflows/${W.reportTax}`)).json;
    const same = await patch(W.reportTax, before.version, { name: "Tax 2" });
    expect(same.status).toBe(200);
    expect(same.json).toMatchObject({ version: before.version, updated_at: before.updated_at });
    expectErr(await patch(W.reportTax, before.version, { key: "khac" }), "VALIDATION_ERROR");
    expectErr(
      await as("PATCH", `/admin/workflows/${W.reportTax}`, { name: "x" }),
      "VALIDATION_ERROR",
    );
    expectErr(await patch(ID.unknown, 1, { name: "x" }), "NOT_FOUND");
  });

  it("ADM-FR-10 · M2-R25 · version tăng với MỖI trường: name, description, app_type, base_url, secret_id, input_schema (kể cả chỉ đổi thứ tự), output_field, enabled", async () => {
    let v = 1;
    const bump = async (body: Record<string, unknown>) => {
      const res = await patch(W.reportTax, v, body);
      expect(res.status).toBe(200);
      expect(res.json.version).toBe(v + 1);
      v += 1;
    };
    await bump({ name: "Tax đổi tên" });
    await bump({ description: desc(30) });
    await bump({ app_type: "chat" });
    await bump({ base_url: "https://other.example.com/v2" });
    await bump({ secret_id: ID.secret.old });
    await bump({ input_schema: [param("a"), param("b")] });
    await bump({ input_schema: [param("b"), param("a")] });
    await bump({ output_field: "result" });
    await bump({ output_field: null });
    await bump({ enabled: false });
    expect((await patch(W.reportTax, v, { secret_id: ID.unknown })).status).toBe(400);
  });

  it("ADM-FR-10 · M2-R07 · đổi secret_id sang secret lạ → 400 INVALID_REFERENCE; đổi sang secret khác → used_by của secret cũ/mới đổi theo", async () => {
    const bad = await patch(W.reportTax, 1, { secret_id: ID.unknown });
    expectErr(bad, "INVALID_REFERENCE");
    expect(bad.json.error.details).toMatchObject({ field: "secret_id" });
    expect((await patch(W.reportTax, 1, { secret_id: ID.secret.old })).status).toBe(200);
    const list = (await as("GET", "/admin/secrets")).json.items;
    expect(list.find((s: Json) => s.name === "DIFY_OLD_KEY").used_by).toEqual(["report-tax"]);
  });
});

describe("ADM-BR-04 · AC-A06 · không rò secret và không có route ngoài phạm vi", () => {
  it("AC-A06 · ADM-BR-04 · workflow trỏ secret tạo bằng API (LEAK_1): GET list/detail/usages chỉ có secret {id,name}, không chứa LEAK_1", async () => {
    const sid = await apiSecret(env, "DIFY_LEAK_KEY", LEAK_1);
    const created = await as("POST", "/admin/workflows", newWf({ key: "leak-wf", secret_id: sid }));
    expect(created.status).toBe(201);
    const texts = [
      created.text,
      (await as("GET", "/admin/workflows")).text,
      (await as("GET", `/admin/workflows/${created.json.id}`)).text,
      (await as("GET", `/admin/workflows/${created.json.id}/usages`)).text,
    ];
    for (const t of texts) expect(leakForms(LEAK_1).filter((f) => t.includes(f))).toEqual([]);
    expect(created.json.secret).toEqual({ id: sid, name: "DIFY_LEAK_KEY" });
    for (const k of ["ciphertext", "iv", "value", "key_version"])
      expect(created.text).not.toContain(`"${k}"`);
  });

  it("ADM-FR-12 · M2 không làm Kiểm tra kết nối / Lấy schema từ Dify: POST …/test-connection và …/dify-schema → 404", async () => {
    for (const p of ["test-connection", "dify-schema"]) {
      expect((await as("POST", `/admin/workflows/${W.translate}/${p}`, {})).status).toBe(404);
    }
  });
});

describe("ADM-FR-10 · đồng thời", () => {
  it("ADM-FR-10 · M2-R25 · 15 PATCH song song cùng version → đúng 1×200 và 14×409 VERSION_CONFLICT", async () => {
    const rs = await Promise.all(
      Array.from({ length: 15 }, (_, i) => patch(W.reportTax, 1, { name: `Tax ${i}` })),
    );
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(
      rs.filter((r) => r.status === 409 && r.json.error.code === "VERSION_CONFLICT"),
    ).toHaveLength(14);
    expect(await version(W.reportTax)).toBe(2);
  });
});
