// fix-review-r1 · kho thẻ người theo phiên: đổi user/tenant ⇒ xoá; kết quả đang bay của phiên cũ bị bỏ; thẻ làm mới ⇒ version tăng.
import { describe, expect, it } from "bun:test";
import type { PersonCard } from "@ai/contracts/people";
import { createCardStore } from "./person-card-store";

const card = (id: string, name: string): PersonCard => ({
  user_id: id,
  display_name: name,
  job_title: null,
  avatar: null,
  department: null,
});

describe("kho thẻ người theo phiên [fix-review-r1]", () => {
  it("đổi phiên (user/tenant) ⇒ thẻ phiên trước biến mất, không rò sang phiên sau", () => {
    const s = createCardStore(1000);
    const e = s.begin("t1:u1", ["a"]);
    s.put("t1:u1", e, [card("a", "An")]);
    expect(s.get("t1:u1", "a")?.display_name).toBe("An");
    expect(s.get("t1:u2", "a")).toBeUndefined();
    expect(s.have("t1:u2", "a")).toBe(false);
    expect(s.get("t1:u1", "a")).toBeUndefined();
  });

  it("kết quả đang bay của phiên cũ không ghi vào phiên mới", () => {
    const s = createCardStore(1000);
    const e = s.begin("t1:u1", ["a"]);
    s.ensure("t2:u9");
    s.put("t1:u1", e, [card("a", "An")]);
    expect(s.get("t2:u9", "a")).toBeUndefined();
    expect(s.have("t2:u9", "a")).toBe(false);
  });

  it("thẻ hết hạn rồi tải lại (cùng số thẻ) ⇒ version vẫn tăng để giao diện cập nhật", () => {
    let t = 0;
    const s = createCardStore(1000, () => t);
    const e = s.begin("t:u", ["a"]);
    s.put("t:u", e, [card("a", "An cũ")]);
    s.done("t:u", e, ["a"]);
    const v1 = s.version();
    t = 5000;
    expect(s.have("t:u", "a")).toBe(false);
    s.put("t:u", s.begin("t:u", ["a"]), [card("a", "An mới")]);
    expect(s.version()).toBeGreaterThan(v1);
    expect(s.get("t:u", "a")?.display_name).toBe("An mới");
  });

  it("đang đọc ⇒ have = true cho tới khi done", () => {
    const s = createCardStore(1000);
    const e = s.begin("t:u", ["a"]);
    expect(s.have("t:u", "a")).toBe(true);
    s.done("t:u", e, ["a"]);
    expect(s.have("t:u", "a")).toBe(false);
  });
});
