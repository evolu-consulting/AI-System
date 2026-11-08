// CR-125 · cr125-purchase-templates · 3 mẫu «Quy trình mua hàng» của Thư viện hợp lệ như mọi FlowDef (parse + kiểm sự kiện), đủ 11 dòng,
// nhóm theo MÃ và mọi mã đều có trong nhóm fixture seed (công ty demo đủ nhóm ⇒ templateReadiness xanh), Phần 1 có «Trả lại» về bước so sánh giá.
import { describe, expect, it } from "bun:test";
import { CONTRACTS_MANIFEST } from "@ai/contracts/app-manifest";
import { flowDefIssues, parallelStageIssues, parseFlowDef } from "@ai/contracts/hub-admin";
import { MODULES, templateNeeds, templateReadiness } from "@ai/contracts/modules";
import { TEMPLATE_GROUPS } from "../../seed/seed.cr125-config";
import {
  NEVER_TRIGGER,
  PURCHASE_PARENT,
  PURCHASE_PHASE_KEYS,
  PURCHASE_TEMPLATES,
} from "./purchase-templates";

type Obj = Record<string, unknown>;
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
    for (const t of [...PURCHASE_TEMPLATES, PURCHASE_PARENT]) {
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
      expect(parallelStageIssues(t.stages as never)).toEqual([]);
    }
  });

  it("Phần 1–3 và cha: «Bắt đầu khi» không bao giờ đúng (chỉ chạy làm lượt con / bằng phiếu ⇒ không mở trùng theo sự kiện HĐ)", () => {
    for (const t of [...PURCHASE_TEMPLATES, PURCHASE_PARENT])
      expect([t.key, t.trigger]).toEqual([t.key, NEVER_TRIGGER]);
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

  it("Phần 1: «Giám đốc duyệt ngân sách» có Trả lại về bước so sánh giá (sau khi gộp, số bước vẫn đúng); dòng 3 là MỘT bước cùng duyệt", () => {
    const s = stagesOf(0);
    const gd = s.find((x) => x.name.startsWith("4 Giám đốc duyệt"));
    const compare = s.find((x) => x.name.startsWith("3 Lập bảng so sánh"));
    expect(gd?.after.back_to_steps).toEqual([compare?.step]);
    expect(s.map((x) => x.step)).toEqual(s.map((_, i) => i));
    expect(s.filter((x) => /^3 .*duyệt phương án/.test(x.name))).toHaveLength(1);
  });

  it("dòng 3 / 6 / 10 duyệt CÙNG LÚC (luật tất cả), nhóm theo mã", () => {
    const rows = [
      [0, "3 ", ["truong-bo-phan", "tai-chinh"]],
      [1, "6 ", ["phap-che", "ke-toan", "truong-bo-phan"]],
      [2, "10 ", ["ke-toan-truong", "giam-doc"]],
    ] as const;
    for (const [i, prefix, keys] of rows) {
      const par = stagesOf(i)?.filter((x) => x.name.startsWith(prefix) && x.after.parallel);
      expect([i, par?.length]).toEqual([i, 1]);
      const p = par?.[0]?.after.parallel as { groups: { group_key: string }[]; rule: string };
      expect([p.rule, p.groups.map((g) => g.group_key)]).toEqual(["all", [...keys]]);
    }
  });

  it("«Quy trình mua hàng» (cha): phiếu 5 ô cho mọi người → 3 Quy trình con → Đã xong; từ chối / huỷ → Không mua", () => {
    const s = PURCHASE_PARENT.stages as (St & {
      node?: string;
      start_form?: Obj;
      outcome?: string;
    })[];
    expect(s.map((x) => x.node ?? x.executor.kind)).toEqual([
      "core.start-form",
      "core.subprocess",
      "core.subprocess",
      "core.subprocess",
      "set",
      "set",
    ]);
    expect(s[0]?.start_form?.fields).toHaveLength(5);
    expect(s[0]?.start_form?.starters).toEqual({ kind: "everyone" });
    const subs = s
      .slice(1, 4)
      .map((x) => x.executor as unknown as { def_key: string; branches: { goto_step: number }[] });
    expect(subs.map((x) => x.def_key)).toEqual([...PURCHASE_PHASE_KEYS]);
    for (const x of subs) expect(x.branches.map((b) => b.goto_step)).toEqual([5, 5]);
    expect([s[4]?.outcome, s[5]?.outcome]).toEqual(["approved", "rejected"]);
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
