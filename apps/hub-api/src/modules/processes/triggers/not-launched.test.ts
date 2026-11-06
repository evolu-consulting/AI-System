// CR-122 · P11b · luật thuần: sự kiện chốt mà không có lượt ⇒ mã lý do cho app.
import { describe, expect, it } from "bun:test";
import { notLaunchedReason } from "./not-launched";

const base = { planned: 1, ran: 0, refused: [], errors: 0, retrying: false, noActor: false };

describe("P11b · notLaunchedReason", () => {
  it("có lượt / còn thử lại ⇒ null", () => {
    expect(notLaunchedReason({ ...base, ran: 1 })).toBeNull();
    expect(notLaunchedReason({ ...base, errors: 1, retrying: true })).toBeNull();
  });
  it("0 flow / không người gây / hết thử / thiếu nhóm / từ chối khác", () => {
    expect(notLaunchedReason({ ...base, planned: 0 })).toBe("FLOW_NOT_ASSIGNED");
    expect(notLaunchedReason({ ...base, noActor: true })).toBe("FLOW_REFUSED");
    expect(notLaunchedReason({ ...base, errors: 1 })).toBe("FLOW_START_FAILED");
    expect(notLaunchedReason({ ...base, refused: ["group_missing:a,b"] })).toBe(
      "FLOW_GROUP_MISSING:a,b",
    );
    expect(notLaunchedReason({ ...base, refused: ["FLOW_NODE_FEATURE_OFF:x"] })).toBe(
      "FLOW_REFUSED",
    );
  });
});
