// CR-130 · fix UAT · user ngoài (đối tác) không bao giờ có gói contracts ở shell (không gọi /pack/contracts/*, /me/stream, /pack/nav ⇒ 403).
import { describe, expect, test } from "bun:test";
import { packsFor } from "./use-shell-packs";

describe("packsFor", () => {
  test("nội bộ: giữ nguyên cờ", () => {
    expect(packsFor({ contracts: true, community: true }, false)).toEqual({
      contracts: true,
      community: true,
    });
  });
  test("user ngoài: contracts luôn false (kể cả mặc định bật trước khi tải /pack/me), Bảng tin theo cờ", () => {
    expect(packsFor({ contracts: true, community: true }, true)).toEqual({
      contracts: false,
      community: true,
    });
    expect(packsFor({ community: false }, true)).toEqual({ community: false, contracts: false });
  });
});
