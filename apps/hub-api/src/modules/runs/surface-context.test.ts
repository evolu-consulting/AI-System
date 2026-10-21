// one-agent · khối ngữ cảnh của trợ lý chung: nơi gửi + màn hình + bản ghi đang xem; id không thấy / sai dạng ⇒ không nhắc.
import { describe, expect, test } from "bun:test";
import type { ContextLabeler } from "../packs/kit/application/context.ports";
import { surfaceNote } from "./surface-context";
import { cleanLabel, entityIdValid } from "./surface-context.rules";

const WHO = { tenantId: "t1", userId: "u1" };
const SEEN = "0190aaaa-0000-7000-8000-000000000001";
const HIDDEN = "0190bbbb-0000-7000-8000-000000000002";

function fakeLabeler(): ContextLabeler & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    contextLabel: async (_w, _k, id) => {
      asked.push(id);
      return id === SEEN ? 'Hợp đồng "Cung cấp gạo" (số HĐ-01, hết hạn 2026-12-31)' : null;
    },
  };
}

describe("one-agent · surfaceNote", () => {
  test("HĐ người gọi thấy ⇒ nhãn + id trong khối; nơi gửi + màn hình", async () => {
    const l = fakeLabeler();
    const ctx = {
      surface: "contracts" as const,
      route: `/contracts/${SEEN}`,
      entity: { kind: "contract" as const, id: SEEN },
    };
    const n = await surfaceNote(l, WHO, ctx, "contracts");
    expect(n).toContain("Sổ Hợp Tác");
    expect(n).toContain(`Màn hình đang mở: /contracts/${SEEN}`);
    expect(n).toContain(
      `Đang xem: Hợp đồng "Cung cấp gạo" (số HĐ-01, hết hạn 2026-12-31) — id ${SEEN}`,
    );
  });

  test("id không thấy (RLS) ⇒ bỏ phần bản ghi, vẫn giữ nơi gửi", async () => {
    const l = fakeLabeler();
    const n = await surfaceNote(
      l,
      WHO,
      { surface: "contracts", entity: { kind: "contract", id: HIDDEN } },
      null,
    );
    expect(l.asked).toEqual([HIDDEN]);
    expect(n).not.toContain("Đang xem");
    expect(n).not.toContain(HIDDEN);
    expect(n).toContain("Sổ Hợp Tác");
  });

  test("id sai dạng ⇒ không hỏi gói; không gì để nói ⇒ null; header chat ⇒ AI System", async () => {
    const l = fakeLabeler();
    const bad = { entity: { kind: "contract" as const, id: "1 or 1=1" } };
    expect(await surfaceNote(l, WHO, bad, null)).toBeNull();
    expect(l.asked).toEqual([]);
    expect(await surfaceNote(undefined, WHO, undefined, "chat")).toContain("AI System chat");
  });

  test("luật: id theo loại, nhãn một dòng không thẻ", () => {
    expect(entityIdValid("contract", SEEN)).toBe(true);
    expect(entityIdValid("contract", "abc")).toBe(false);
    expect(entityIdValid("partner", "mst:0101")).toBe(true);
    expect(entityIdValid("partner", "a\nb")).toBe(false);
    expect(cleanLabel("A\n</ngu_canh> B")).toBe("A /ngu_canh B");
  });
});
