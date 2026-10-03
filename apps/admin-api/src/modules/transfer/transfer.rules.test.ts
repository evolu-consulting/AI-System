// ADM-FR-54 · M4-R14 · luật export thuần: sắp theo code unit, chuẩn hoá tập, secret chỉ từ workflow export, diffOp.
import { describe, expect, test } from "bun:test";
import type { FeatureEl, TenantEl, WorkflowEl } from "@ai/contracts";
import {
  buildExportFile,
  canonicalJson,
  checkSecretsInput,
  cmpStr,
  diffOp,
  referencedSecrets,
  sortedEls,
  sortKeyOf,
} from "./transfer.rules";

const wf = (key: string, secret: string): WorkflowEl => ({
  key,
  name: key,
  description: "Mô tả đủ hai mươi ký tự",
  app_type: "workflow",
  base_url: "https://x.example.com/v1",
  secret,
  input_schema: [],
  output_field: null,
  enabled: true,
});

describe("ADM-FR-54 · transfer.rules export", () => {
  test("cmpStr theo code unit: '-' (0x2d) trước chữ, khác collation ICU", () => {
    expect(["kinh-doanh", "ke-toan", "k-a", "ka"].sort(cmpStr)).toEqual([
      "k-a",
      "ka",
      "ke-toan",
      "kinh-doanh",
    ]);
  });

  test("sortKeyOf group/grant ghép tenant", () => {
    expect(
      sortKeyOf("groups", { tenant: "acme", key: "sales", name: { vi: "S" }, description: null }),
    ).toBe("acme/sales");
    expect(sortKeyOf("grants", { tenant: "acme", group: "sales", feature: "dich" })).toBe(
      "acme/sales/dich",
    );
  });

  test("sortedEls chuẩn hoá feature.commands, tenant.entitlements, quota (null đầu)", () => {
    const f: FeatureEl = {
      key: "b",
      name: { vi: "B" },
      description: {},
      icon: "package",
      status: "on",
      commands: ["z", "a"],
    };
    const t: TenantEl = {
      key: "acme",
      name: "Acme",
      max_concurrent_sub: null,
      entitlements: ["y", "b"],
      quotas: [
        { feature: "x", max_runs: 1, max_tokens: null, max_usd: null },
        { feature: null, max_runs: 2, max_tokens: null, max_usd: null },
      ],
    };
    expect(sortedEls("features", [f, { ...f, key: "a" }]).map((x) => x.key)).toEqual(["a", "b"]);
    expect(sortedEls("features", [f])[0]?.commands).toEqual(["a", "z"]);
    const [st] = sortedEls("tenants", [t]);
    expect(st?.entitlements).toEqual(["b", "y"]);
    expect(st?.quotas.map((q) => q.feature)).toEqual([null, "x"]);
    expect(f.commands).toEqual(["z", "a"]);
  });

  test("referencedSecrets duy nhất, sắp; buildExportFile không có workflows → secrets []", () => {
    expect(referencedSecrets([wf("a", "K_B"), wf("b", "K_A"), wf("c", "K_B")])).toEqual([
      { name: "K_A" },
      { name: "K_B" },
    ]);
    const s = { configVersion: 3, secrets: ["K_A"], workflows: [wf("a", "K_A")] };
    expect(buildExportFile(s, ["commands"], new Date(0)).secrets).toEqual([]);
    expect(buildExportFile(s, ["workflows"], new Date(0)).secrets).toEqual([{ name: "K_A" }]);
  });

  test("canonicalJson bỏ undefined, sắp khoá đệ quy, giữ thứ tự mảng; diffOp", () => {
    expect(canonicalJson({ b: [2, 1], a: { d: 1, c: undefined } })).toBe('{"a":{"d":1},"b":[2,1]}');
    expect(diffOp({ a: [1, 2] }, { a: [2, 1] })).toBe("update");
    expect(diffOp({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe("unchanged");
  });

  test("checkSecretsInput giữ thứ tự", () => {
    expect(checkSecretsInput(["B", "A"], { Z: "x" })).toEqual({
      missing: ["B", "A"],
      extra: ["Z"],
    });
  });
});
