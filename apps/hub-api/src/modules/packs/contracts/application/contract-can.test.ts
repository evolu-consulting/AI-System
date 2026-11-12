// CR-127 K2a-1 · BR-09/44: `can` theo trạng thái + người gọi.
import { describe, expect, it } from "bun:test";
import { type CanFacts, canOf } from "./contract-can";

const base: CanFacts = {
  status: "draft",
  extract_state: "ready",
  superseded: false,
  effect: null,
  hold: null,
  created_by: "u-create",
  owner_user_id: "u-owner",
  submitted_by: null,
};
const none = {
  submit: false,
  withdraw: false,
  recreate: false,
  new_version: false,
  hold: false,
  release: false,
};

describe("canOf", () => {
  it("DRAFT đã đọc xong: người tạo / phụ trách gửi được; người khác không", () => {
    expect(canOf(base, "u-create").submit).toBe(true);
    expect(canOf(base, "u-owner").submit).toBe(true);
    expect(canOf(base, "u-other")).toEqual(none);
    expect(canOf(base, null)).toEqual(none);
  });
  it("AI đang đọc / đọc lỗi ⇒ chưa gửi được", () => {
    expect(canOf({ ...base, extract_state: "reading" }, "u-create").submit).toBe(false);
    expect(canOf({ ...base, extract_state: "failed" }, "u-create").submit).toBe(false);
  });
  it("PROCESSING: chỉ người gửi gần nhất rút được", () => {
    const p = { ...base, status: "processing", submitted_by: "u-create" };
    expect(canOf(p, "u-create")).toEqual({ ...none, withdraw: true });
    expect(canOf(p, "u-owner")).toEqual(none);
  });
  it("REJECT: người tạo / phụ trách tạo lại", () => {
    const r = { ...base, status: "reject" };
    expect(canOf(r, "u-owner")).toEqual({ ...none, recreate: true });
    expect(canOf(r, "u-other")).toEqual(none);
  });
  it("DONE hiệu lực: bản mới cho mọi người, tạm khoá chỉ phụ trách; có khoá ⇒ mở khoá", () => {
    const d = { ...base, status: "done", effect: "active" };
    expect(canOf(d, "u-other")).toEqual({ ...none, new_version: true });
    expect(canOf(d, "u-owner")).toEqual({ ...none, new_version: true, hold: true });
    const h = { ...d, hold: { by: "u-owner", reason: "x" } };
    expect(canOf(h, "u-owner")).toEqual({ ...none, new_version: true, release: true });
  });
  it("DONE đã gia hạn ⇒ không tạm khoá; bản đã bị thay ⇒ không nút nào", () => {
    expect(canOf({ ...base, status: "done", effect: "renewed" }, "u-owner").hold).toBe(false);
    expect(canOf({ ...base, status: "done", effect: null, superseded: true }, "u-owner")).toEqual(
      none,
    );
  });
});
