// esign-flow · soạn mẫu luồng phía client: thêm bước Ký số (một lần, luôn cuối), bước mới chèn trước Ký số, Ký số không di chuyển,
// người duyệt cụ thể thay phòng, kiểm người ký.
import { describe, expect, it } from "bun:test";
import type { FlowStep } from "../api-flow";
import { flowReducer, newReview, validateFlow } from "./flow-state";

const G = "00000000-0000-4000-8000-000000000001";
const U = "00000000-0000-4000-8000-0000000000a1";
const base = (): FlowStep[] => [{ ...newReview([], G), key: "s1", name: "Soạn" }];

describe("esign-flow · flow-state", () => {
  it("thêm Ký số một lần ở cuối; thêm bước duyệt chèn trước Ký số; Ký số không di chuyển", () => {
    let s = flowReducer(base(), { type: "addEsign", name: "Ký số" });
    s = flowReducer(s, { type: "addEsign", name: "Ký số" });
    expect(s.map((x) => x.kind)).toEqual(["review", "esign"]);
    s = flowReducer(s, { type: "addReview", department_group_id: G });
    expect(s.map((x) => x.kind)).toEqual(["review", "review", "esign"]);
    expect(flowReducer(s, { type: "move", index: 1, dir: 1 })).toBe(s);
    expect(flowReducer(s, { type: "move", index: 2, dir: -1 })).toBe(s);
  });
  it("kiểm: người ký cụ thể thiếu người; người duyệt cụ thể thay phòng", () => {
    let s = flowReducer(base(), { type: "addEsign", name: "Ký số" });
    s = flowReducer(s, { type: "patch", index: 1, patch: { company_signer: { mode: "user" } } });
    expect(validateFlow(s).map((i) => i.code)).toEqual(["SIGNER_USER_REQUIRED"]);
    const r = flowReducer(base(), {
      type: "patch",
      index: 0,
      patch: { department_group_id: null, approver_user_id: U },
    });
    expect(validateFlow(r)).toEqual([]);
  });
});
