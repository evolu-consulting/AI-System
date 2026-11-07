// CR-124 · q4 · FLOW4-FR-08/09/10 · 2 flow mẫu nhận: hợp lệ theo FlowDef + sự kiện `contract.received`, chỉ «Nhận HĐ thường» không điều kiện,
// và seed hub 0121 khớp nguồn TS từng byte JSON (một nguồn — Luật GỐC 1).
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTRACTS_MANIFEST } from "@ai/contracts/app-manifest";
import { flowDefIssues, parseFlowDef } from "@ai/contracts/hub-admin";
import { RECEIVE_TEMPLATES, receiveDefOf, receiveTriggerOf } from "./flow-templates-receive.def";

const SQL = readFileSync(
  join(
    import.meta.dir,
    "../../../../../../packages/db/migrations-hub/0121_partner_receive_templates.sql",
  ),
  "utf8",
);

describe("flow mẫu nhận HĐ đối tác", () => {
  for (const t of RECEIVE_TEMPLATES) {
    it(`${t.key}: FlowDef hợp lệ, kết thúc đúng 3 kết quả của sự kiện`, () => {
      const def = receiveDefOf(t);
      const p = parseFlowDef(def);
      expect(p.ok && !p.legacy).toBe(true);
      expect(flowDefIssues(def, CONTRACTS_MANIFEST.events)).toEqual([]);
      const outcomes = t.stages().flatMap((s) => (s.outcome ? [s.outcome] : []));
      expect(outcomes.sort()).toEqual(["confirmed", "declined", "returned"]);
    });
    it(`${t.key}: seed hub 0121 khớp nguồn TS`, () => {
      expect(SQL).toContain(`$j$${JSON.stringify(t.stages())}$j$`);
      expect(SQL).toContain(`$j$${JSON.stringify(receiveTriggerOf(t))}$j$`);
      expect(SQL).toContain(`'${t.id}'`);
    });
  }
  it("chỉ «Nhận HĐ thường» không điều kiện — đó là flow mặc định của sự kiện bắt buộc", () => {
    const ev = CONTRACTS_MANIFEST.events.find((e) => e.key === "contract.received");
    expect(ev?.required).toBe(true);
    const un = RECEIVE_TEMPLATES.filter((t) => !t.when).map((t) => t.key);
    expect(un).toEqual([ev?.defaultFlowKey as string]);
  });
});
