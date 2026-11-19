// CR-187 BR-187-5 · CR-191 · công tắc «Cho công ty khác tìm thấy công ty mình»: ai đổi được, khi nào bật được.
import { describe, expect, test } from "bun:test";
import { discoverableView } from "./discoverable";

const base = { listed: false, has_profile: true };

describe("CR-187 · discoverableView", () => {
  test("vai khác quản trị Sổ Hợp Tác ⇒ công tắc khoá + nói lý do", () => {
    expect(discoverableView(base, false)).toEqual({
      checked: false,
      enabled: false,
      needProfile: false,
      locked: true,
    });
  });

  test("quản trị Sổ Hợp Tác + đủ tên pháp lý + MST ⇒ bật được", () => {
    expect(discoverableView(base, true)).toEqual({
      checked: false,
      enabled: true,
      needProfile: false,
      locked: false,
    });
  });

  test("thiếu MST hoặc tên pháp lý ⇒ khoá + báo lý do", () => {
    expect(discoverableView({ ...base, has_profile: false }, true)).toEqual({
      checked: false,
      enabled: false,
      needProfile: true,
      locked: false,
    });
  });

  test("đang bật mà hồ sơ thiếu ⇒ vẫn tắt được", () => {
    expect(discoverableView({ listed: true, has_profile: false }, true)).toEqual({
      checked: true,
      enabled: true,
      needProfile: false,
      locked: false,
    });
  });
});
