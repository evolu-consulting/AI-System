// CR-121 c14b · thứ tự và luồng lưu của thanh lưu chung (một lần bấm, Thông tin rồi Quota, version nối tiếp).
import { describe, expect, it } from "bun:test";
import {
  type FlowAction,
  type FlowEvent,
  type FlowState,
  flow,
  IDLE,
  saveOrder,
} from "./save-order";

const run = (events: FlowEvent[]): { state: FlowState; actions: FlowAction[] } => {
  let state = IDLE;
  const actions: FlowAction[] = [];
  for (const e of events) {
    const [s, a] = flow(state, e);
    state = s;
    actions.push(...a);
  }
  return { state, actions };
};
const both = { info: true, quota: true };

describe("CR-121 c14b · saveOrder", () => {
  it("chỉ form đang đổi; cả hai ⇒ Thông tin trước Quota", () => {
    expect(saveOrder({ info: false, quota: false })).toEqual([]);
    expect(saveOrder({ info: false, quota: true })).toEqual(["quota"]);
    expect(saveOrder({ info: true, quota: false })).toEqual(["info"]);
    expect(saveOrder(both)).toEqual(["info", "quota"]);
  });
});

describe("CR-121 c14b · flow (một lần bấm Lưu)", () => {
  it("cả hai đổi ⇒ đúng 2 lời gọi nối tiếp: Quota chỉ gửi sau khi Thông tin xong VÀ version mới về", () => {
    const first = flow(IDLE, { t: "click", dirty: both, version: 5 });
    expect(first[1]).toEqual(["submit-info"]); // chưa gửi Quota
    const same = flow(first[0], { t: "infoSettled", version: 5 }); // chưa có version mới ⇒ coi là lỗi, không gửi Quota
    expect(same[1]).toEqual(["info-failed-quota-skipped"]);
    const ok = run([
      { t: "click", dirty: both, version: 5 },
      { t: "infoSettled", version: 6 },
      { t: "quotaSettled", ok: true },
    ]);
    expect(ok.actions).toEqual(["submit-info", "submit-quota"]);
    expect(ok.state.step).toBe("idle");
  });

  it("Thông tin lỗi/xung đột (version không đổi) ⇒ Quota KHÔNG gửi, báo cả hai chưa lưu", () => {
    const r = run([
      { t: "click", dirty: both, version: 5 },
      { t: "infoSettled", version: 5 },
    ]);
    expect(r.actions).toEqual(["submit-info", "info-failed-quota-skipped"]);
  });

  it("Quota lỗi ở lần 2 ⇒ báo Thông tin đã lưu, Quota chưa", () => {
    const r = run([
      { t: "click", dirty: both, version: 5 },
      { t: "infoSettled", version: 6 },
      { t: "quotaSettled", ok: false },
    ]);
    expect(r.actions).toEqual(["submit-info", "submit-quota", "quota-failed-after-info"]);
    expect(r.state.step).toBe("idle");
  });

  it("chỉ một form đổi ⇒ một lời gọi, không thông báo thừa", () => {
    expect(
      run([
        { t: "click", dirty: { info: true, quota: false }, version: 3 },
        { t: "infoSettled", version: 4 },
      ]).actions,
    ).toEqual(["submit-info"]);
    expect(
      run([
        { t: "click", dirty: { info: false, quota: true }, version: 3 },
        { t: "quotaSettled", ok: false },
      ]).actions,
    ).toEqual(["submit-quota"]);
    expect(run([{ t: "click", dirty: { info: false, quota: false }, version: 3 }]).actions).toEqual(
      [],
    );
  });
});
