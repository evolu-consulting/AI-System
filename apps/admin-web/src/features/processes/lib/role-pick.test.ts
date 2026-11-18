import { describe, expect, it } from "bun:test";
import { whoPatch, whoValueOf } from "./approve-panel";
import type { StageDraft } from "./draft-types";
import { ROLE_PICK, roleFromLabel, roleKeyOf, rolesOfStages, roleToDef } from "./role-pick";
import { emptyEscalate, escalateToDef } from "./wait-form";

describe("CR-182 · vai ở trình soạn", () => {
  it("khoá vai sinh từ nhãn: bỏ dấu, đ ⇒ d, gạch ngang, ≤ 40", () => {
    expect(roleKeyOf("Người duyệt cấp 1")).toBe("nguoi-duyet-cap-1");
    expect(roleKeyOf("  Đại diện!! ")).toBe("dai-dien");
    expect(roleKeyOf("???")).toBe("");
    expect(roleKeyOf("a".repeat(60)).length).toBe(40);
    expect(roleFromLabel("Kế toán").key).toBe("ke-toan");
  });
  it("chọn «Theo vai» bỏ phòng/người, chọn lại phòng thì bỏ vai", () => {
    const s = { review: { approverUserId: "u1" } } as unknown as StageDraft;
    const p = whoPatch(s, ROLE_PICK, () => ({}));
    expect(p.groupId).toBe("");
    expect(p.review?.role).toEqual({ key: "", label: "" });
    expect(p.review?.approverUserId).toBeUndefined();
    const roleStage = { review: p.review } as unknown as StageDraft;
    expect(whoValueOf(roleStage, "g1")).toBe(ROLE_PICK);
    const back = whoPatch(roleStage, "g1", (id) => ({ groupId: id }));
    expect(back.review?.role).toBeUndefined();
  });
  it("vai chưa đủ không ghi ra def, chuyển cấp theo vai ghi role", () => {
    expect(roleToDef({ key: "", label: "x" })).toBeUndefined();
    expect(roleToDef({ key: "a", label: " A " })).toEqual({ key: "a", label: "A" });
    const esc = {
      ...emptyEscalate(),
      on: true,
      afterH: "24",
      role: { key: "tp", label: "Trưởng phòng" },
    };
    expect(escalateToDef({ escalate: esc })).toEqual({
      after_h: 24,
      role: { key: "tp", label: "Trưởng phòng" },
    });
  });
  it("gom vai đã có (Duyệt, cùng duyệt, chuyển cấp), một khoá một dòng", () => {
    const r = { key: "a", label: "A" };
    const stages = [
      { review: { role: r }, escalate: emptyEscalate() },
      {
        parallel: {
          groups: [
            { groupId: "", label: "x", role: r },
            { groupId: "", label: "y", role: { key: "b", label: "B" } },
          ],
        },
        escalate: emptyEscalate(),
      },
    ] as unknown as StageDraft[];
    expect(rolesOfStages(stages).map((x) => x.key)).toEqual(["a", "b"]);
  });
});
