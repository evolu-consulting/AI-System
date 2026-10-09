// ADM-FR-54 · M4-R14 · M4-R15 · AC-A06 · luật thuần Import/Export (test-plan-cd §1.2): `transfer.rules.ts`
// (chữ ký plan-cd §6). Xanh ở T7 (export) / T8 (planImport). Snapshot dựng từ fixture M2/M3 (`_transfer-data.ts`).
import { describe, expect, it } from "bun:test";
import { loadTransferContract, loadTransferRules } from "../_cd-modules";
import {
  BAO_CAO_MOI,
  commandEl,
  featureEl,
  fileOf,
  grantEl,
  groupEl,
  header,
  ruleSnapshot,
  TYPES,
  tenantEl,
  workflowEl,
} from "../_transfer-data";

// biome-ignore lint/suspicious/noExplicitAny: phần tử file dựng tay
type Obj = Record<string, any>;
const NOW = new Date("2026-10-03T08:00:00.000Z");
const snap = ruleSnapshot();
const only = (over: Obj): Obj => ({ ...header(), ...over });
const plan = async (file: Obj, s: Obj = snap) => (await loadTransferRules()).planImport(file, s);
const sortKeyOf = (t: string, e: Obj): string =>
  t === "commands"
    ? e.name
    : t === "groups"
      ? `${e.tenant}/${e.key}`
      : t === "grants"
        ? `${e.tenant}/${e.group}/${e.feature}`
        : e.key;
const codes = (p: Obj) => (p.errors as Obj[]).map((e) => e.code);

// [khoá, nằm trong commands[].input_map] — `input_map.<field>.value` là hằng của M2 (`InputMapEntrySchema`), không phải secret
function keysDeep(v: unknown, out: [string, boolean][] = [], inMap = false): [string, boolean][] {
  if (Array.isArray(v)) for (const x of v) keysDeep(x, out, inMap);
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.push([k, inMap]);
      keysDeep(x, out, inMap || k === "input_map");
    }
  }
  return out;
}

describe("ADM-FR-54 · export", () => {
  it("ADM-FR-54 · C-R01 · M4-R14 · exportFileName = config-v{n}.yaml", async () => {
    const r = await loadTransferRules();
    expect(r.exportFileName(43)).toBe("config-v43.yaml");
    expect(r.exportFileName(0)).toBe("config-v0.yaml");
  });

  it("ADM-FR-54 · C-R02 · M4-R14 · buildExportFile: qua ConfigFileSchema; đầu file đúng; mỗi danh sách sắp theo key", async () => {
    const r = await loadTransferRules();
    const { ConfigFileSchema } = await loadTransferContract();
    const f = r.buildExportFile(snap, TYPES, NOW);
    expect(ConfigFileSchema.safeParse(f).success).toBe(true);
    expect(f).toMatchObject({
      format: "ai-system/config",
      format_version: 1,
      config_version: 43,
      exported_at: NOW.toISOString(),
    });
    for (const t of TYPES) {
      const keys = (f[t] as Obj[]).map((e) => sortKeyOf(t, e));
      expect(keys).toHaveLength((snap[t] as Obj[]).length);
      expect(keys).toEqual([...keys].sort());
    }
  });

  it("ADM-FR-54 · C-R03 · AC-A06 · secrets = đúng tên workflow tham chiếu (không DIFY_OLD_KEY); không id/*_id/value/last4/ciphertext", async () => {
    const r = await loadTransferRules();
    const f = r.buildExportFile(snap, TYPES, NOW);
    expect(f.secrets).toEqual([{ name: "DIFY_INVOICE_KEY" }, { name: "DIFY_TRANSLATE_KEY" }]);
    // BR-04 / plan-cd §3: mục secret chỉ có `name`; không giá trị/last4/iv ở đâu ngoài hằng input_map
    for (const s of f.secrets as Obj[]) expect(Object.keys(s)).toEqual(["name"]);
    for (const [k, inMap] of keysDeep(f)) {
      const banned = ["last4", "ciphertext", "iv"].includes(k) || (k === "value" && !inMap);
      expect(k === "id" || k.endsWith("_id") || banned).toBe(false);
    }
  });

  it("ADM-FR-54 · C-R04 · types=['commands'] → chỉ khoá commands (+ đầu file); secrets rỗng", async () => {
    const r = await loadTransferRules();
    const f = r.buildExportFile(snap, ["commands"], NOW);
    const extra = Object.keys(f).filter(
      (k) =>
        ![
          "format",
          "format_version",
          "config_version",
          "exported_at",
          "secrets",
          "commands",
        ].includes(k),
    );
    expect(extra).toEqual([]);
    expect(f.commands).toHaveLength(5);
    expect(f.secrets ?? []).toEqual([]);
  });
});

describe("ADM-FR-54 · planImport", () => {
  it("ADM-FR-54 · C-R05 · diffOp: null → add; khác thứ tự khoá → unchanged; đổi name → update", async () => {
    const r = await loadTransferRules();
    const w = workflowEl("translate");
    const reordered = Object.fromEntries(Object.entries(w).reverse());
    expect(r.diffOp(null, w)).toBe("add");
    expect(r.diffOp(w, reordered)).toBe("unchanged");
    expect(r.diffOp(w, { ...w, name: "Workflow dịch" })).toBe("update");
  });

  it("ADM-FR-54 · C-R06 · M4-AC09 · sửa translate + thêm report-new → items, summary, missing_secrets, errors []", async () => {
    const before = workflowEl("translate");
    const after = { ...before, description: "Dịch văn bản — bản import mới" };
    const reportNew = {
      ...workflowEl("report-tax"),
      key: "report-new",
      name: "Workflow report-new",
      secret: "DIFY_REPORT_KEY",
    };
    const file = fileOf(snap);
    file.workflows = [
      after,
      ...file.workflows.filter((w: Obj) => w.key !== "translate"),
      reportNew,
    ];
    const p = await plan(file);
    expect(p.errors).toEqual([]);
    expect(p.items).toHaveLength(2);
    expect(p.items).toContainEqual({
      type: "workflow",
      key: "translate",
      op: "update",
      before,
      after,
    });
    expect(p.items).toContainEqual({
      type: "workflow",
      key: "report-new",
      op: "add",
      before: null,
      after: reportNew,
    });
    const total = TYPES.reduce((n, t) => n + (file[t] as Obj[]).length, 0);
    expect(p.summary).toEqual({ added: 1, updated: 1, unchanged: total - 2 });
    expect(p.missing_secrets).toEqual([{ name: "DIFY_REPORT_KEY", used_by: ["report-new"] }]);
  });

  it("ADM-FR-54 · C-R07 · M4-R14 không xoá · file chỉ có translate không đổi → items [] (thực thể ngoài file không có op)", async () => {
    const p = await plan(only({ workflows: [workflowEl("translate")] }));
    expect(p.items).toEqual([]);
    expect(p.summary).toEqual({ added: 0, updated: 0, unchanged: 1 });
    expect(p.errors).toEqual([]);
  });

  it("ADM-FR-54 · C-R08 · commands[0].workflow = 'translat' → REF_NOT_FOUND tại commands[0].workflow", async () => {
    const p = await plan(only({ commands: [{ ...commandEl("dich"), workflow: "translat" }] }));
    expect(p.errors[0]).toMatchObject({ path: "commands[0].workflow", code: "REF_NOT_FOUND" });
  });

  it("ADM-FR-54 · C-R09 · Q11 · tenant chưa có (newco) → TENANT_NOT_FOUND tại tenants[0].key; không item add tenant", async () => {
    const newco = {
      key: "newco",
      name: "New Co",
      max_concurrent_sub: null,
      entitlements: [],
      quotas: [],
    };
    const p = await plan(only({ tenants: [newco] }));
    expect(p.errors[0]).toMatchObject({ path: "tenants[0].key", code: "TENANT_NOT_FOUND" });
    expect((p.items as Obj[]).filter((i) => i.type === "tenant")).toEqual([]);
  });

  it("ADM-FR-54 · C-R10 · tenant 'platform' → PLATFORM_TENANT", async () => {
    const p = await plan(
      only({ tenants: [{ ...tenantEl("acme"), key: "platform", name: "Platform" }] }),
    );
    expect(codes(p)).toContain("PLATFORM_TENANT");
  });

  it("ADM-FR-54 · C-R11 · 2 workflow cùng key → DUPLICATE_KEY tại workflows[1].key", async () => {
    const p = await plan(only({ workflows: [workflowEl("translate"), workflowEl("translate")] }));
    expect(p.errors).toContainEqual(
      expect.objectContaining({ path: "workflows[1].key", code: "DUPLICATE_KEY" }),
    );
  });

  it("CR-055 · C-R12 · command mới không thuộc feature nào → hợp lệ (không lỗi, op add); thêm vào bao-cao.commands → vẫn không lỗi", async () => {
    const cmd = { ...BAO_CAO_MOI, workflow: "report-tax" };
    const p1 = await plan(only({ commands: [cmd] }));
    expect(p1.errors).toEqual([]);
    expect(codes(p1)).not.toContain("COMMAND_NEEDS_FEATURE");
    const feat = { ...featureEl("bao-cao"), commands: ["bao-cao-moi", "xuat-bao-cao"] };
    const p2 = await plan(only({ commands: [cmd], features: [feat] }));
    expect(p2.errors).toEqual([]);
  });

  it("ADM-FR-54 · C-R13 · grant cần entitlement: chưa có → NOT_ENTITLED; cùng file thêm entitlement → hết lỗi", async () => {
    const grant = grantEl("acme", "kinh-doanh", "thu-nghiem");
    const p1 = await plan(only({ grants: [grant] }));
    expect(codes(p1)).toContain("NOT_ENTITLED");
    const acme = tenantEl("acme", {
      entitlements: ["bao-cao", "dich-thuat", "ke-toan", "thu-nghiem"],
    });
    const p2 = await plan(only({ tenants: [acme], grants: [grant] }));
    expect(p2.errors).toEqual([]);
  });

  it("ADM-FR-54 · C-R14 · input_map trỏ field không có → RULE, params.code = INPUT_MAP_INVALID", async () => {
    const dich = commandEl("dich");
    const bad = {
      ...dich,
      input_map: { ...dich.input_map, khong_co: { source: "arg", value: "text" } },
    };
    const p = await plan(only({ commands: [bad] }));
    expect(p.errors).toContainEqual(
      expect.objectContaining({
        code: "RULE",
        params: expect.objectContaining({ code: "INPUT_MAP_INVALID" }),
      }),
    );
  });

  it("ADM-FR-54 · C-R15 · đổi tập commands của ke-toan → 1 item feature/ke-toan update, after.commands = tập mới", async () => {
    const feat = { ...featureEl("ke-toan"), commands: ["kiemtra-hoadon", "tom-tat"] };
    const p = await plan(only({ features: [feat] }));
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ type: "feature", key: "ke-toan", op: "update" });
    expect([...p.items[0].after.commands].sort()).toEqual(["kiemtra-hoadon", "tom-tat"]);
  });

  it("ADM-FR-54 · C-R16 · key hiển thị group = tenant/group, grant = tenant/group/feature", async () => {
    const p = await plan(
      only({
        groups: [groupEl("acme", "phap-ly", "Pháp lý")],
        grants: [grantEl("acme", "phap-ly", "ke-toan")],
      }),
    );
    expect(p.errors).toEqual([]);
    const keys = (p.items as Obj[]).map((i) => `${i.type}:${i.key}:${i.op}`).sort();
    expect(keys).toEqual(["grant:acme/phap-ly/ke-toan:add", "group:acme/phap-ly:add"]);
  });

  it("ADM-FR-54 · C-R17 · 150 lỗi → errors ≤ 100, phần tử cuối TOO_MANY_ERRORS", async () => {
    const cmds = Array.from({ length: 150 }, (_, i) => ({
      ...commandEl("tom-tat"),
      name: `cmd-${i}`,
      workflow: "khong-co",
    }));
    const p = await plan(only({ commands: cmds }));
    expect(p.errors.length).toBeLessThanOrEqual(100);
    expect(p.errors.at(-1).code).toBe("TOO_MANY_ERRORS");
  });

  it("ADM-FR-54 · C-R18 · M4-R15 · checkSecretsInput: missing/extra", async () => {
    const r = await loadTransferRules();
    expect(r.checkSecretsInput(["A", "B"], { A: "x", C: "y" })).toEqual({
      missing: ["B"],
      extra: ["C"],
    });
    expect(r.checkSecretsInput(["A", "B"], { A: "x", B: "y" })).toEqual({ missing: [], extra: [] });
  });
});
