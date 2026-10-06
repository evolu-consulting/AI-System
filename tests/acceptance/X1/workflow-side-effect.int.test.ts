// X1-AC10 · ADM-FR-10 · HUB-FR-95 · cột `admin.workflows.side_effect` qua API Admin (plan §1, §2.1; test-plan §2 AC10 I):
// POST/PATCH/GET, version + config_version, audit `after.side_effect`, restore snapshot cũ thiếu trường, export/import
// (file cũ thiếu trường không âm thầm tắt cờ), quyền `hub_ro`, file migration 0009. DB qc (createM3Env: M1 + catalog M2).
// Mỗi `it` tự dựng lại dữ liệu (beforeEach reset3).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WorkflowSchema } from "@ai/contracts";
import {
  auditMark,
  auditSince,
  createM3Env,
  exportReq,
  ID,
  importReq,
  type M3Env,
  type Res,
} from "../M4/_cd";
import { FILE_NAME, TYPES } from "../M4/_transfer-data";
import { ROOT } from "./_x1";

// biome-ignore lint/suspicious/noExplicitAny: yaml/json đã parse
type Obj = Record<string, any>;
let env: M3Env;
const W = ID.workflow;

beforeAll(async () => {
  env = await createM3Env();
});
beforeEach(async () => {
  await env.reset3();
});
afterAll(async () => {
  await env.close();
});

const as = async (method: string, path: string, body?: unknown): Promise<Res> =>
  env.call(method, path, { token: await env.admin(), body });
const newWf = (over: Record<string, unknown> = {}) => ({
  key: "x1-side",
  name: "X1 side effect",
  description: "d".repeat(40),
  app_type: "workflow",
  base_url: "https://dify.example.com/v1",
  secret_id: ID.secret.translate,
  ...over,
});
const row = async (id: string) =>
  (await env.owner`select * from admin.workflows where id = ${id}`)[0] as Obj | undefined;
const colExists = async () =>
  (
    await env.owner<{ n: number }[]>`select count(*)::int as n from information_schema.columns
      where table_schema = 'admin' and table_name = 'workflows' and column_name = 'side_effect'`
  )[0]?.n === 1;
/** Đặt cờ bằng owner (không bump version); chưa có cột ⇒ bỏ qua để ca đỏ ở expect. */
async function setFlag(id: string, on: boolean): Promise<void> {
  if (await colExists())
    await env.owner.unsafe(`update admin.workflows set side_effect = ${on} where id = '${id}'`);
}
const parseYaml = (text: string): Obj => Bun.YAML.parse(text) as Obj;
const toYaml = (o: Obj): string => `# x1 qc\n${JSON.stringify(o, null, 2)}\n`;
async function exported(): Promise<Obj> {
  const res = await exportReq(env, `?types=${TYPES.join(",")}`);
  expect(res.status).toBe(200);
  return parseYaml(res.text);
}
const dry = (content: string) => importReq(env, { file_name: FILE_NAME, content }, "1");

describe("X1-AC10 · API workflows", () => {
  it("X1-AC10 · ADM-FR-10 · POST không gửi side_effect → 201, side_effect false (response + DB)", async () => {
    const res = await as("POST", "/admin/workflows", newWf());
    expect(res.status).toBe(201);
    const wf = WorkflowSchema.parse(res.json) as Obj;
    expect(wf.side_effect).toBe(false);
    expect((await row(res.json.id))?.side_effect).toBe(false);
  });

  it("X1-AC10 · ADM-FR-10 · POST side_effect:true → GET /admin/workflows/:id và danh sách trả true", async () => {
    const res = await as("POST", "/admin/workflows", newWf({ side_effect: true }));
    expect(res.status).toBe(201);
    const id = res.json.id as string;
    const one = await as("GET", `/admin/workflows/${id}`);
    expect(one.json?.side_effect).toBe(true);
    const list = await as("GET", "/admin/workflows?q=x1-side");
    expect(((list.json?.items ?? []) as Obj[]).map((i) => [i.key, i.side_effect])).toEqual([
      ["x1-side", true],
    ]);
  });

  it("X1-AC10 · HUB-FR-95 · PATCH đổi side_effect → version+1, config_version+1, response true; PATCH vắng trường (đổi name) → giữ true", async () => {
    const v0 = (await row(W.translate))?.version as number;
    const c0 = await env.cfg();
    const r1 = await as("PATCH", `/admin/workflows/${W.translate}`, {
      version: v0,
      side_effect: true,
    });
    expect(r1.status).toBe(200);
    expect(r1.json?.side_effect).toBe(true);
    expect(r1.json?.version).toBe(v0 + 1);
    expect(await env.cfg()).toBe(c0 + 1);
    const r2 = await as("PATCH", `/admin/workflows/${W.translate}`, {
      version: v0 + 1,
      name: "Translate X1",
    });
    expect(r2.status).toBe(200);
    expect(r2.json?.side_effect).toBe(true);
    expect((await row(W.translate))?.side_effect).toBe(true);
  });

  it("X1-AC10 · ADM-FR-10 · side_effect không phải boolean → 400 VALIDATION_ERROR", async () => {
    const v0 = (await row(W.translate))?.version as number;
    const r = await as("PATCH", `/admin/workflows/${W.translate}`, {
      version: v0,
      side_effect: "yes",
    });
    expect(r.status).toBe(400);
    expect(r.json?.error?.code).toBe("VALIDATION_ERROR");
  });
});

describe("X1-AC10 · audit + restore", () => {
  it("X1-AC10 · M4 audit · PATCH side_effect → 1 dòng audit workflow/update có before.side_effect false, after.side_effect true", async () => {
    const mark = await auditMark(env);
    const v0 = (await row(W.translate))?.version as number;
    expect(
      (await as("PATCH", `/admin/workflows/${W.translate}`, { version: v0, side_effect: true }))
        .status,
    ).toBe(200);
    const rows = (await auditSince(env, mark)).filter((r) => r.entity === "workflow");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.before?.side_effect).toBe(false);
    expect(rows[0]?.after?.side_effect).toBe(true);
  });

  it("X1-AC10 · ADM-FR-52 · restore snapshot cũ THIẾU side_effect → khôi phục trường khác, side_effect giữ giá trị hiện tại (true)", async () => {
    await setFlag(W.reportTax, true);
    const v0 = (await row(W.reportTax))?.version as number;
    const mark = await auditMark(env);
    expect(
      (await as("PATCH", `/admin/workflows/${W.reportTax}`, { version: v0, name: "Tax X1" }))
        .status,
    ).toBe(200);
    const [e] = (await auditSince(env, mark)).filter((r) => r.entity === "workflow");
    expect(Boolean(e?.id)).toBe(true);
    // Bản sao dòng audit như snapshot trước X1 (không có khoá side_effect) — audit_log chỉ cho INSERT.
    const [old] = await env.owner<{ id: string }[]>`insert into admin.audit_log
        (tenant_id, actor_id, actor_username, action, entity, entity_id, entity_name, config_version,
         entity_version, before, after, summary, snapshot)
      select tenant_id, actor_id, actor_username, action, entity, entity_id, entity_name, config_version,
         entity_version, before - 'side_effect', after - 'side_effect', summary, snapshot
      from admin.audit_log where id = ${e?.id as string} returning id`;
    const res = await as("POST", `/admin/audit/${old?.id}/restore`, {});
    expect(res.status).toBe(200);
    const after = await row(W.reportTax);
    expect(after?.name).not.toBe("Tax X1");
    expect(after?.side_effect).toBe(true);
  });
});

describe("X1-AC10 · export / import", () => {
  it("X1-AC10 · ADM-FR-54 · export: mọi phần tử workflows có side_effect boolean; report-tax = true", async () => {
    await setFlag(W.reportTax, true);
    const file = await exported();
    const wfs = file.workflows as Obj[];
    expect(wfs.length).toBeGreaterThan(0);
    expect(wfs.every((w) => typeof w.side_effect === "boolean")).toBe(true);
    expect(wfs.find((w) => w.key === "report-tax")?.side_effect).toBe(true);
  });

  it("X1-AC10 · ADM-FR-54 · import cập nhật với file cũ VẮNG side_effect → không có mục workflow nào trong diff (cờ true không bị tắt)", async () => {
    await setFlag(W.reportTax, true);
    const file = await exported();
    for (const w of file.workflows as Obj[]) delete w.side_effect;
    const res = await dry(toYaml(file));
    expect(res.status).toBe(200);
    expect(res.json?.valid).toBe(true);
    expect(((res.json?.items ?? []) as Obj[]).filter((i) => i.type === "workflow")).toEqual([]);
  });

  it("X1-AC10 · ADM-FR-54 · import có side_effect khác hiện tại → diff workflow:translate:update, before.side_effect false, after.side_effect true", async () => {
    const file = await exported();
    const t = (file.workflows as Obj[]).find((w) => w.key === "translate");
    expect(t?.side_effect).toBe(false);
    if (t) t.side_effect = true;
    const res = await dry(toYaml(file));
    expect(res.status).toBe(200);
    const items = ((res.json?.items ?? []) as Obj[]).filter((i) => i.type === "workflow");
    expect(items.map((i) => `${i.key}:${i.op}`)).toEqual(["translate:update"]);
    expect(items[0]?.before?.side_effect).toBe(false);
    expect(items[0]?.after?.side_effect).toBe(true);
  });

  it("X1-AC10 · ADM-FR-54 · import tạo workflow mới vắng side_effect (áp dụng thật) → DB false", async () => {
    const file = await exported();
    const t = (file.workflows as Obj[]).find((w) => w.key === "translate") as Obj;
    const clone: Obj = { ...t, key: "translate-x1" };
    delete clone.side_effect;
    file.workflows = [...(file.workflows as Obj[]), clone];
    const res = await importReq(
      env,
      { file_name: FILE_NAME, content: toYaml(file), base_config_version: await env.cfg() },
      "0",
    );
    expect(res.status).toBe(200);
    const [r] = await env.owner<Obj[]>`select * from admin.workflows where key = 'translate-x1'`;
    expect(r?.side_effect).toBe(false);
  });
});

describe("X1-AC10 · DB", () => {
  it("X1-AC10 · HUB-FR-95 · X1-R09 · hub_ro SELECT được admin.workflows.side_effect; NOT NULL default false", async () => {
    const [p] = await env.owner<{ ok: boolean }[]>`select has_column_privilege('hub_ro',
      'admin.workflows', 'side_effect', 'SELECT') as ok`;
    expect(p?.ok).toBe(true);
    const [c] = await env.owner<Obj[]>`select is_nullable, column_default, data_type
      from information_schema.columns
      where table_schema = 'admin' and table_name = 'workflows' and column_name = 'side_effect'`;
    expect(c).toEqual({ is_nullable: "NO", column_default: "false", data_type: "boolean" });
  });

  it("X1-AC10 · plan §1 · migration 0009_x1_workflow_side_effect.sql đúng 1 câu ADD COLUMN side_effect boolean DEFAULT false NOT NULL", () => {
    const sql = readFileSync(
      join(ROOT, "packages/db/migrations/0009_x1_workflow_side_effect.sql"),
      "utf8",
    );
    const stmts = sql
      .split("--> statement-breakpoint")
      .map((s) => s.replace(/--.*$/gm, "").trim())
      .filter(Boolean);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toMatch(
      /^ALTER TABLE "?admin"?\."?workflows"? ADD COLUMN "?side_effect"? boolean DEFAULT false NOT NULL;?$/i,
    );
  });
});
