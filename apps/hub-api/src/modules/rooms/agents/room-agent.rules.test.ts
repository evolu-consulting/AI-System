// HUB-FR-44 · HUB-FR-101 · X2b2-R11 bổ sung (review RV1 #1) · `out/` của tin agent chờ `side_effect` chỉ người gọi.
import { describe, expect, test } from "bun:test";
import { roomOutputsVisible } from "./room-agent.rules";

describe("X2b2-R11 RV1 #1 · roomOutputsVisible", () => {
  test("chờ side_effect (pending) ⇒ người khác không thấy, người gọi thấy", () => {
    const p = { waitKind: "side_effect", pendingConfirm: true } as const;
    expect(roomOutputsVisible({ ...p, isCaller: false })).toBe(false);
    expect(roomOutputsVisible({ ...p, isCaller: true })).toBe(true);
  });

  test("chờ đã giải quyết (hết pending) ⇒ mọi thành viên thấy (R11 bình thường)", () => {
    expect(
      roomOutputsVisible({ waitKind: "side_effect", pendingConfirm: false, isCaller: false }),
    ).toBe(true);
  });

  test("need_input / không chờ ⇒ mọi thành viên thấy", () => {
    expect(
      roomOutputsVisible({ waitKind: "need_input", pendingConfirm: false, isCaller: false }),
    ).toBe(true);
    expect(roomOutputsVisible({ waitKind: null, pendingConfirm: false, isCaller: false })).toBe(
      true,
    );
  });
});
