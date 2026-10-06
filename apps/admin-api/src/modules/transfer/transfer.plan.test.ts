// ADM-FR-54 · M4-R14 · planImport + parse yaml: chuẩn hoá quota, merge tenant (chỉ thêm), cắt lỗi, luật core/tên, yaml.
import { describe, expect, test } from "bun:test";
import type { CommandEl, ConfigFile, FeatureEl, TenantEl, WorkflowEl } from "@ai/contracts";
import { checkImportSize, parseConfigText } from "./transfer.import";
import { Errs, formatPath } from "./transfer.import-ctx";
import { mergeTenant, normQuota, planImport } from "./transfer.plan";

const head = {
  format: "ai-system/config",
  format_version: 1,
  config_version: 3,
  exported_at: "2026-10-01T09:00:00.000Z",
} as const;
const wf: WorkflowEl = {
  key: "wf-a",
  name: "A",
  description: "Mô tả đủ hai mươi ký tự",
  app_type: "workflow",
  base_url: "https://x.example.com/v1",
  secret: "KEY_A",
  input_schema: [],
  output_field: null,
  enabled: true,
};
const cmd = (name: string, aliases: string[] = []): CommandEl => ({
  name,
  aliases,
  description: { vi: name },
  workflow: "wf-a",
  args: [],
  input_map: {},
  output: { field: "text", render: "markdown" },
  mode: "sync",
  timeout_s: 30,
  enabled: true,
});
const feat = (key: string, commands: string[]): FeatureEl => ({
  key,
  name: { vi: key },
  description: {},
  icon: "package",
  status: "on",
  commands,
});
const acme: TenantEl = {
  key: "acme",
  name: "Acme",
  max_concurrent_sub: null,
  entitlements: ["f-a"],
  quotas: [{ feature: null, max_runs: 10, max_tokens: null, max_usd: "5.00" }],
};
const snap = {
  configVersion: 9,
  secrets: ["KEY_A"],
  workflows: [wf],
  commands: [cmd("c-a", ["ca"]), cmd("c-b")],
  features: [feat("core", []), feat("f-a", ["c-a", "c-b"])],
  tenants: [acme],
  groups: [],
  grants: [],
};
const file = (over: Partial<ConfigFile>): ConfigFile => ({ ...head, ...over }) as ConfigFile;
const codes = (f: Partial<ConfigFile>) =>
  planImport(file(f), snap).errors.map((e) => `${e.path}:${e.params?.code ?? e.code}`);

describe("ADM-FR-54 · transfer.plan", () => {
  test("formatPath: số → [i], chuỗi → .k", () => {
    expect(formatPath(["commands", 2, "workflow"])).toBe("commands[2].workflow");
    expect(formatPath([])).toBe("");
  });

  test("normQuota: max_usd về 2 chữ số thập phân như numeric(12,2)", () => {
    expect(
      normQuota({ feature: null, max_runs: null, max_tokens: null, max_usd: "300" }).max_usd,
    ).toBe("300.00");
    expect(normQuota({ feature: "x", max_runs: 1, max_tokens: null, max_usd: "1.5" }).max_usd).toBe(
      "1.50",
    );
  });

  test("mergeTenant: entitlement hợp (không thu hồi), quota upsert theo feature, giữ dòng ngoài file", () => {
    const f: TenantEl = {
      ...acme,
      entitlements: ["f-b"],
      quotas: [{ feature: "f-a", max_runs: 3, max_tokens: null, max_usd: null }],
    };
    const m = mergeTenant(acme, f);
    expect(m.entitlements).toEqual(["f-a", "f-b"]);
    expect(m.quotas.map((q) => q.feature)).toEqual([null, "f-a"]);
  });

  test("tenant chỉ bớt entitlement/quota → unchanged (chỉ thêm, không xoá)", () => {
    const p = planImport(file({ tenants: [{ ...acme, entitlements: [], quotas: [] }] }), snap);
    expect(p.summary).toEqual({ added: 0, updated: 0, unchanged: 1 });
  });
});

describe("ADM-FR-54 · transfer.plan luật", () => {
  test("Errs > 100 → 99 + TOO_MANY_ERRORS{total}", () => {
    const e = new Errs();
    for (let i = 0; i < 150; i++) e.add(`x[${i}]`, "SCHEMA", "m");
    const out = e.finish();
    expect(out).toHaveLength(100);
    expect(out.at(-1)).toMatchObject({ code: "TOO_MANY_ERRORS", params: { total: "150" } });
  });

  test("alias trùng tên command khác → RULE COMMAND_NAME_TAKEN tại aliases", () => {
    expect(codes({ commands: [cmd("c-b", ["ca"])] })).toEqual([
      "commands[0].aliases:COMMAND_NAME_TAKEN",
    ]);
  });

  test("core: entitlement/grant/status off → CORE_FEATURE_PROTECTED", () => {
    expect(codes({ tenants: [{ ...acme, entitlements: ["core"] }] })).toEqual([
      "tenants[0].entitlements[0]:CORE_FEATURE_PROTECTED",
    ]);
    expect(codes({ features: [{ ...feat("core", []), status: "off" }] })).toEqual([
      "features[0].status:CORE_FEATURE_PROTECTED",
    ]);
  });

  test("bỏ command khỏi feature duy nhất → COMMAND_NEEDS_FEATURE ở features[i].commands", () => {
    expect(codes({ features: [feat("f-a", ["c-a"])] })).toEqual([
      "features[0].commands:COMMAND_NEEDS_FEATURE",
    ]);
  });

  test("tắt workflow còn command bật (ngoài file) → WORKFLOW_IN_USE", () => {
    expect(codes({ workflows: [{ ...wf, enabled: false }] })).toEqual([
      "workflows[0].enabled:WORKFLOW_IN_USE",
    ]);
  });
});

describe("X1 · HUB-FR-95 · side_effect khi nhập", () => {
  const db = { ...snap, workflows: [{ ...wf, side_effect: true }] };
  const wfItems = (w: WorkflowEl) =>
    planImport(file({ workflows: [w] }), db).items.filter((i) => i.type === "workflow");
  test("file cũ thiếu side_effect → giữ giá trị DB, không đổi (unchanged)", () => {
    expect(wfItems(wf)).toEqual([]);
  });
  test("có side_effect khác DB → update, after mang giá trị file", () => {
    const [it] = wfItems({ ...wf, side_effect: false });
    expect(it?.op).toBe("update");
    expect(it?.after.side_effect).toBe(false);
  });
  test("workflow mới thiếu side_effect → add, after = phần tử file (write ghi false)", () => {
    const [it] = wfItems({ ...wf, key: "wf-new" });
    expect(it?.op).toBe("add");
    expect(it?.after).toEqual({ ...wf, key: "wf-new" });
  });
});

describe("ADM-FR-54 · parseConfigText", () => {
  test("alias → YAML_SYNTAX không vị trí; khoá trùng → YAML_SYNTAX có line", () => {
    const a = parseConfigText("a: &x 1\nb: *x\n");
    expect(a.errors[0]).toMatchObject({ code: "YAML_SYNTAX", params: { reason: "ALIAS" } });
    const d = parseConfigText("a: 1\na: 2\n");
    expect(d.errors[0]?.code).toBe("YAML_SYNTAX");
    expect(d.errors[0]?.line).toBe(2);
  });

  test("schema sai → SCHEMA với path; hợp lệ → file", () => {
    const bad = parseConfigText(JSON.stringify({ ...head, workflows: [{ ...wf, key: "X" }] }));
    expect(bad.errors[0]).toMatchObject({ code: "SCHEMA", path: "workflows[0].key" });
    expect(parseConfigText(JSON.stringify(head)).file?.config_version).toBe(3);
  });

  test("checkImportSize đếm byte UTF-8", () => {
    expect(() => checkImportSize("ệ".repeat(349_526))).toThrow();
    expect(() => checkImportSize("x".repeat(1_048_576))).not.toThrow();
  });
});
