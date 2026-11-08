// CR-125 · cr125-purchase-templates · 3 mẫu «Quy trình mua hàng» của Thư viện hợp lệ như mọi FlowDef (parse + kiểm sự kiện), đủ 11 dòng,
// nhóm theo MÃ và mọi mã đều có trong nhóm fixture seed (công ty demo đủ nhóm ⇒ templateReadiness xanh), Phần 1 có «Trả lại» về bước so sánh giá.
import { describe, expect, it } from "bun:test";
import { CONTRACTS_MANIFEST } from "@ai/contracts/app-manifest";
import { flowDefIssues, parseFlowDef } from "@ai/contracts/hub-admin";
import { MODULES, templateNeeds, templateReadiness } from "@ai/contracts/modules";
import { TEMPLATE_GROUPS } from "../../seed/seed.cr125-config";
import { PURCHASE_TEMPLATES } from "./purchase-templates";

type St = {
  name: string;
  step: number;
  executor: { kind: string };
  after: Record<string, unknown>;
};
const stagesOf = (i: number) => PURCHASE_TEMPLATES[i]?.stages as St[];

describe("mẫu Thư viện «Quy trình mua hàng»", () => {
  it("3 mẫu, mỗi mẫu là FlowDef hợp lệ (parse + sự kiện của app)", () => {
    expect(PURCHASE_TEMPLATES.map((t) => t.name.slice(-30))).toHaveLength(3);
    for (const t of PURCHASE_TEMPLATES) {
      const def = {
        key: t.key,
        name: t.name,
        app: t.app,
        owner: "library" as const,
        trigger: t.trigger,
        stages: t.stages,
      };
      const p = parseFlowDef(def);
      expect([t.key, p.ok]).toEqual([t.key, true]);
      expect(flowDefIssues(def as never, CONTRACTS_MANIFEST.events)).toEqual([]);
    }
  });

  it("đủ 11 dòng của bảng (số bước đầu mỗi dòng 1..11) và mỗi mẫu dưới trần 50 bước", () => {
    const rows = new Set(
      PURCHASE_TEMPLATES.flatMap((t) =>
        (t.stages as St[]).flatMap((s) => /^(\d+)/.exec(s.name)?.[1] ?? []),
      ),
    );
    expect([...rows].map(Number).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    for (const t of PURCHASE_TEMPLATES) expect(t.stages.length).toBeLessThan(50);
  });

  it("Phần 1: «Giám đốc duyệt ngân sách» có Trả lại về bước so sánh giá; «A + B» là hai bước Duyệt nối tiếp", () => {
    const s = stagesOf(0);
    const gd = s.find((x) => x.name.startsWith("4 Giám đốc duyệt"));
    const compare = s.find((x) => x.name.startsWith("3 Lập bảng so sánh"));
    expect(gd?.after.back_to_steps).toEqual([compare?.step]);
    const tbp = s.findIndex((x) => x.name.startsWith("3 Trưởng bộ phận duyệt"));
    expect([s[tbp]?.executor.kind, s[tbp + 1]?.executor.kind]).toEqual(["approve", "approve"]);
  });

  it("nhóm theo MÃ, mọi mã có trong nhóm fixture seed ⇒ công ty demo không thiếu nhóm nào", () => {
    const have = TEMPLATE_GROUPS.map((g) => g.key);
    for (const t of PURCHASE_TEMPLATES) {
      const needs = templateNeeds(t.stages, MODULES);
      const rd = templateReadiness(needs, {
        features: new Set(needs.features.map((f) => f.key)),
        tools: new Set(needs.tools.map((x) => x.key)),
        groupKeys: have,
      });
      expect([t.key, rd.missing.groups, rd.missing.order]).toEqual([t.key, [], []]);
      expect(needs.groups.length).toBeGreaterThan(0);
    }
  });
});
