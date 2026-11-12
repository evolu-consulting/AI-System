// CR-127 · Z1 · BR-79 · unit: đánh giá check `contract_state_drift` (thuần).
import { describe, expect, it } from "bun:test";
import { evaluateContractDrift } from "./contract-state-drift.check";

const ZERO = {
  processing_no_run: 0,
  closed_with_run: 0,
  effect_drift: 0,
  over_plan: 0,
  request_no_event: 0,
};

describe("contract_state_drift · evaluateContractDrift", () => {
  it("không lệch ⇒ ok", () => {
    expect(evaluateContractDrift(ZERO).status).toBe("ok");
  });
  it("trạng thái/hiệu lực lệch ⇒ crit nêu từng nhóm + cách xử lý", () => {
    const r = evaluateContractDrift({ ...ZERO, processing_no_run: 2, effect_drift: 1 });
    expect(r.status).toBe("crit");
    expect(r.message).toContain("2 HĐ đang xử lý nhưng không có lượt duyệt mở");
    expect(r.message).toContain("1 hiệu lực HĐ khác kết quả tính lại");
    expect(r.message).not.toContain("vượt giá trị");
    expect(r.hint).toContain("Rút về");
  });
  it("chỉ lệch số liệu/yêu cầu ⇒ warn", () => {
    expect(evaluateContractDrift({ ...ZERO, over_plan: 1 }).status).toBe("warn");
    expect(evaluateContractDrift({ ...ZERO, request_no_event: 3 }).status).toBe("warn");
  });
});
