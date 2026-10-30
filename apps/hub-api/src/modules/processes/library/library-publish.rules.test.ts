// CR-105 · L2a · B2 (viết TRƯỚC code): kiểm trước khi xuất bản def thư viện — đủ nút hệ thống của khe, không bước không tới được
// (điều kiện không bao giờ đúng), luật khe (`SlotSpec.validate`). Thuần.
import { describe, expect, it } from "bun:test";
import { compileSlotStages } from "../../packs/contracts/domain/approval-slot.rules";
import { defaultSlotBody } from "../../packs/contracts/domain/approval-slot-default.rules";
import { publishIssues, whenSatisfiable } from "./library-publish.rules";

const SYS = ["contracts-route", "contracts-finalize"];
type Stage = { key: string; executor: { kind: string; tool_key?: string }; slot?: unknown };

describe("CR-105 · B2 xuất bản def thư viện", () => {
  it("thiếu nút hệ thống hoặc bước không tới được ⇒ từ chối", () => {
    const body = defaultSlotBody();
    const stages = compileSlotStages(body) as Stage[];
    expect(publishIssues({ stages, systemTools: SYS, bodyIssues: [] })).toEqual([]);

    const noFinalize = stages.filter((s) => s.key !== "finalize");
    expect(publishIssues({ stages: noFinalize, systemTools: SYS, bodyIssues: [] })).toEqual([
      { path: "stages", rule: "SYSTEM_TOOL_MISSING:contracts-finalize" },
    ]);

    const never = {
      op: "and",
      conds: [
        { field: "total_value", op: "ge", value: 100 },
        { field: "total_value", op: "lt", value: 50 },
      ],
    };
    const dead = stages.map((s) =>
      s.key === "s1" ? { ...s, slot: { ...(s.slot as object), when: never } } : s,
    );
    expect(publishIssues({ stages: dead, systemTools: SYS, bodyIssues: [] })).toEqual([
      { path: "stages.2.slot.when", rule: "UNREACHABLE_STEP" },
    ]);

    const fromBody = [{ path: "steps.0.when", rule: "FIRST_CONDITIONAL" }];
    expect(publishIssues({ stages, systemTools: SYS, bodyIssues: fromBody })).toEqual(fromBody);
  });

  it("điều kiện: and rỗng giao nhau ⇒ không tới; or có một vế được ⇒ tới; loại HĐ rỗng ⇒ không tới", () => {
    const tv = (op: string, value: number) => ({ field: "total_value", op, value });
    expect({
      null: whenSatisfiable(null),
      andOk: whenSatisfiable({ op: "and", conds: [tv("ge", 10), tv("le", 10)] }),
      andGap: whenSatisfiable({ op: "and", conds: [tv("gt", 10), tv("le", 10)] }),
      neg: whenSatisfiable({ op: "and", conds: [tv("lt", 0)] }),
      orOne: whenSatisfiable({ op: "or", conds: [tv("lt", 0), tv("ge", 5)] }),
      dealEmpty: whenSatisfiable({ op: "and", conds: [{ field: "deal", in: [] }] }),
      dealDisjoint: whenSatisfiable({
        op: "and",
        conds: [
          { field: "deal", in: ["buy"] },
          { field: "deal", in: ["sell"] },
        ],
      }),
    }).toEqual({
      null: true,
      andOk: true,
      andGap: false,
      neg: false,
      orOne: true,
      dealEmpty: false,
      dealDisjoint: false,
    });
  });
});
