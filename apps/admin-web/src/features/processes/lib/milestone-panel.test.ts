import { describe, expect, test } from "bun:test";
import { isMilestone, milestoneSummary, milestoneWhoPatch } from "./milestone-panel";

const gp = (id: string) => ({ groupId: id });
describe("milestone-panel", () => {
  test("nhận biết node", () => {
    expect(isMilestone({ node: "contracts.milestone-confirm" })).toBe(true);
    expect(isMilestone({})).toBe(false);
  });
  test("chọn phòng ⇒ review + groupId, bỏ người", () => {
    const p = milestoneWhoPatch({ review: { approverUserId: "u1" } }, "g1", gp);
    expect(p.after).toBe("review");
    expect(p.groupId).toBe("g1");
    expect(p.review?.approverUserId).toBeUndefined();
  });
  test("chọn người ⇒ approverUserId, groupId rỗng", () => {
    const p = milestoneWhoPatch({}, "u:u9", gp);
    expect(p.groupId).toBe("");
    expect(p.review?.approverUserId).toBe("u9");
  });
  test("để trống ⇒ xoá cả phòng và người, vẫn kiểu review", () => {
    const p = milestoneWhoPatch({ review: { approverUserId: "u1", need: "all" } }, "", gp);
    expect(p).toMatchObject({ groupId: "", after: "review", review: { need: "all" } });
  });
  test("tóm tắt", () => {
    const l = { owner: "Người phụ trách", due: (n: number) => `hạn ${n} giờ` };
    expect(
      milestoneSummary({ escalate: { on: true, afterH: "48", groupId: "" } }, "Kế toán", l),
    ).toBe("Kế toán · hạn 48 giờ");
    expect(
      milestoneSummary({ escalate: { on: false, afterH: "24", groupId: "" } }, undefined, l),
    ).toBe("Người phụ trách");
  });
});
