// CR-130 · fix-e2e-web · bản thật KHÔNG có cờ mock: cờ `community` chỉ do Hub tính (chỉ bản dựng mock mới bật sẵn).
import { expect, test } from "bun:test";
import { COMMUNITY_MOCK } from "./mock-flag";
import { PACK_FALLBACKS } from "./modules";

test("bản dựng thường: không mock ⇒ chỉ contracts có mặc định, Bảng tin theo cờ máy chủ", () => {
  expect(COMMUNITY_MOCK).toBe(false);
  expect(PACK_FALLBACKS).toEqual({ contracts: true });
});
