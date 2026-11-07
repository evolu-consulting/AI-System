// CR-122 · E3 · luật thuần chờ sự kiện nhiều kết quả + ánh xạ trạng thái phong bì ⇒ sự kiện gói.
import { describe, expect, it } from "bun:test";
import { esignEventOf } from "../../../packs/contracts/public";
import { TIMEOUT_KEY, waitBranchRules, waitKeysOf, winningEvent } from "./wait-event-branch.rules";

const ex = {
  kind: "wait_event",
  event: "esign.completed",
  also_events: ["esign.declined", "esign.completed"],
  branches: [{ on: "esign.declined", goto_step: 3 }],
};

describe("wait-event-branch.rules", () => {
  it("khoá chờ: chính + phụ, không trùng; loại khác ⇒ rỗng", () => {
    expect(waitKeysOf(ex)).toEqual(["esign.completed", "esign.declined"]);
    expect(waitKeysOf({ kind: "set" })).toEqual([]);
  });
  it("sự kiện thắng: nhận sớm nhất, cùng lúc ⇒ theo thứ tự khai, không có ⇒ timeout", () => {
    const k = waitKeysOf(ex);
    const t = new Date(1000);
    expect(winningEvent(k, [])).toBe(TIMEOUT_KEY);
    expect(
      winningEvent(k, [
        { event: "esign.declined", receivedAt: new Date(500) },
        { event: "esign.completed", receivedAt: t },
      ]),
    ).toBe("esign.declined");
    expect(
      winningEvent(k, [
        { event: "esign.declined", receivedAt: t },
        { event: "esign.completed", receivedAt: t },
      ]),
    ).toBe("esign.completed");
  });
  it("luật rẽ suy từ executor (field event)", () => {
    expect(waitBranchRules(ex)).toEqual([
      { field: "event", op: "eq", value: "esign.declined", gotoStep: 3 },
    ]);
    expect(waitBranchRules({ kind: "wait_event", event: "x.y" })).toEqual([]);
  });
});

describe("esignEventOf", () => {
  it("trạng thái cuối ⇒ khoá sự kiện, còn lại ⇒ null", () => {
    expect(esignEventOf("completed")).toBe("esign.completed");
    expect(esignEventOf("declined")).toBe("esign.declined");
    expect(esignEventOf("voided")).toBe("esign.voided");
    expect(esignEventOf("sent" as never)).toBeNull();
  });
});
