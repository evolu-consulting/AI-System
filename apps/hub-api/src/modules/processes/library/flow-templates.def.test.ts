// CR-122 · B · 3 flow mẫu: mỗi mẫu qua `parseFlowDef` + `flowDefIssues` (manifest contracts) + cấu hình node Ký số; Duyệt dùng mã Group;
// không node Ghi giá trị. `flowEdgeIssues = 0` chờ lát A (bước tự có dữ liệu hồ sơ) ⇒ để `skip`.
import { describe, expect, it } from "bun:test";
import { CONTRACTS_MANIFEST } from "@ai/contracts/app-manifest";
import { flowDefIssues, flowEdgeIssues, parseFlowDef } from "@ai/contracts/hub-admin";
import { decodeEsignNodeArgs } from "@ai/contracts/pack-contracts";
import { FLOW_TEMPLATES, flowDefOf } from "./flow-templates.def";

const NAMES = ["Duyệt 2 cấp", "Duyệt theo giá trị", "Duyệt theo phòng ban"];

describe("CR-122 B · flow mẫu Thư viện", () => {
  it("3 mẫu đúng tên, khoá riêng, id riêng", () => {
    expect(FLOW_TEMPLATES.map((t) => t.name)).toEqual(NAMES);
    expect(new Set(FLOW_TEMPLATES.map((t) => t.key)).size).toBe(3);
    expect(new Set(FLOW_TEMPLATES.map((t) => t.id)).size).toBe(3);
  });

  for (const t of FLOW_TEMPLATES) {
    describe(t.name, () => {
      const def = flowDefOf(t);

      it("parseFlowDef: FlowDef mới hợp lệ (không legacy)", () => {
        const p = parseFlowDef(def);
        expect(p.ok && !p.legacy).toBe(true);
      });

      it("flowDefIssues với sự kiện của manifest contracts = 0 (outcome, điều kiện đúng dữ kiện + kiểu)", () => {
        expect(flowDefIssues(def, CONTRACTS_MANIFEST.events)).toEqual([]);
      });

      it("cấu hình node Ký số hợp lệ (args chỉ có contract_id ⇒ mọi trường lấy cài đặt app)", () => {
        const sends = def.stages.filter(
          (s) => s.executor.kind === "tool" && s.executor.tool_key === "contracts-esign-send",
        );
        expect(sends).toHaveLength(1);
        for (const s of sends) {
          const args = s.executor.kind === "tool" ? s.executor.args : {};
          const consts = Object.fromEntries(
            Object.entries(args).flatMap(([k, v]) => (v.from === "const" ? [[k, v.value]] : [])),
          );
          expect(decodeEsignNodeArgs(consts)).toEqual({ ok: true, config: {} });
          expect(s.real_action).toBe(true);
        }
      });

      it("Duyệt theo MÃ Group, từ chối ⇒ Kết thúc · Từ chối, trả lại ⇒ Kết thúc · Trả lại; không node Ghi giá trị", () => {
        const outcomeAt = (step: number) => def.stages.find((s) => s.step === step)?.outcome;
        const approvals = def.stages.flatMap((s) => (s.executor.kind === "approve" ? [s] : []));
        expect(approvals.length).toBeGreaterThan(0);
        const groupOf = (s: (typeof approvals)[number]) => {
          const a = s.after as { kind: string; group_key?: string; group_id: unknown };
          return [a.kind, typeof a.group_key, a.group_id];
        };
        expect(approvals.map(groupOf)).toEqual(approvals.map(() => ["review", "string", null]));
        const ends = approvals.flatMap((s) => {
          const e = s.executor as { reject_step: number; return_step: number };
          return [outcomeAt(e.reject_step), outcomeAt(e.return_step)];
        });
        expect(ends).toEqual(approvals.flatMap(() => ["rejected", "returned"]));
        const waits = def.stages.flatMap((s) =>
          s.executor.kind === "wait_event" ? (s.executor.branches ?? []) : [],
        );
        expect(waits.map((b) => outcomeAt(b.goto_step))).toEqual(waits.map(() => "rejected"));
        // Kết thúc là node `set` rỗng có outcome; mọi node `set` khác (Ghi giá trị) bị cấm trong mẫu.
        const sets = def.stages.filter((s) => s.executor.kind === "set");
        expect(sets.map((s) => s.outcome !== undefined)).toEqual(sets.map(() => true));
        expect(def.stages.map((s) => s.outcome).filter(Boolean)).toEqual([
          "approved",
          "rejected",
          "returned",
        ]);
      });
    });
  }

  it("mẫu 2: Nếu giá trị > 100 triệu ⇒ Pháp chế, ngược lại Kế toán, cả hai gộp về Ký số", () => {
    const d = flowDefOf(FLOW_TEMPLATES[1] as never);
    const iff = d.stages[0]?.executor;
    expect(iff).toMatchObject({
      kind: "if",
      then_step: 1,
      else_step: 2,
      when: { conds: [{ from: { kind: "fact", key: "total_value" }, op: "gt", value: 100000000 }] },
    });
    expect(d.stages.slice(1, 3).map((s) => (s.after as { group_key?: string }).group_key)).toEqual([
      "phap-che",
      "ke-toan",
    ]);
    expect(d.stages.slice(1, 3).map((s) => s.next_step)).toEqual([3, 3]);
  });

  it("mẫu 3: phòng ban = X ⇒ nhóm duyệt X; khác X ⇒ truong-phong duyệt; cả hai gộp về Ký số", () => {
    const d = flowDefOf(FLOW_TEMPLATES[2] as never);
    expect(d.stages[0]?.executor).toMatchObject({
      kind: "if",
      then_step: 1,
      else_step: 2,
      when: { conds: [{ from: { kind: "fact", key: "creator_department" }, op: "eq" }] },
    });
    expect(d.stages.slice(1, 3).map((s) => (s.after as { group_key?: string }).group_key)).toEqual([
      "duyet-kinh-doanh",
      "truong-phong",
    ]);
    expect(d.stages.slice(1, 3).map((s) => s.next_step)).toEqual([3, 3]);
    expect(d.stages[3]?.executor).toMatchObject({ kind: "tool", tool_key: "contracts-esign-send" });
  });

  // CHỜ LÁT A: bước tự có dữ liệu hồ sơ (contract_id…) ⇒ cạnh Ký số không còn thiếu `contract_id`. Mở khi A gộp.
  // Khi mở: đánh dấu `node: "contracts.esign"` ở bước Ký số của mẫu + palette = node của manifest contracts, rồi so `[]`.
  it.skip("flowEdgeIssues = 0 (chờ A)", () => {
    for (const t of FLOW_TEMPLATES) expect(flowEdgeIssues(flowDefOf(t) as never, [])).toEqual([]);
  });
});
