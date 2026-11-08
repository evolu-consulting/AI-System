// CR-125 G7 · nguồn nav Sổ Hợp Tác: mục `contracts.partner` lấy số từ cổng đếm của kit (một lần gọi/lượt, song song với mục duyệt);
// cổng vắng/lỗi ⇒ mục vẫn hiện, số 0; tính năng tắt ⇒ không mục và KHÔNG gọi cổng.
import { describe, expect, it } from "bun:test";
import type { PackNavCountPort, PackRunsBridge } from "../kit/public";
import { countedCap } from "../kit/public";
import { contractsNavSource } from "./nav.mount";

const U = { userId: "u1", tenantId: "t1", role: "member", userKind: "internal" } as never;
const port = (n: number, seen: string[] = []): PackNavCountPort => ({
  count: async (u) => {
    seen.push(u.tenantId);
    return n;
  },
});
const runs = (count: number): PackRunsBridge =>
  ({ port: { inboxOf: async () => ({ approver: true, count }) } }) as never;

describe("contractsNavSource · contracts.partner", () => {
  it("có số từ cổng đếm, đúng tenant người xem; mục duyệt đi sau, độc lập", async () => {
    const seen: string[] = [];
    const s = contractsNavSource(
      async () => true,
      runs(2),
      async () => true,
      port(5, seen),
    );
    expect(await s.caps(U)).toEqual([
      { cap: "contracts.partner", count: 5 },
      { cap: "contracts.review", count: 2 },
    ]);
    expect(seen).toEqual(["t1"]);
  });

  it("tính năng tắt ⇒ không mục và không gọi cổng đếm", async () => {
    const seen: string[] = [];
    const s = contractsNavSource(
      async () => true,
      undefined,
      async () => false,
      port(5, seen),
    );
    expect(await s.caps(U)).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("không có cổng đếm ⇒ mục hiện, số 0 (như trước)", async () => {
    const s = contractsNavSource(
      async () => true,
      undefined,
      async () => true,
    );
    expect(await s.caps(U)).toEqual([{ cap: "contracts.partner", count: 0 }]);
  });
});

describe("countedCap (kit)", () => {
  it("đếm lỗi ⇒ 0, không ném; số âm/NaN ⇒ 0; số lẻ ⇒ làm tròn xuống", async () => {
    const bad: PackNavCountPort = {
      count: async () => {
        throw new Error("db");
      },
    };
    expect(await countedCap("x.y", bad, U)).toEqual({ cap: "x.y", count: 0 });
    expect(await countedCap("x.y", port(-3), U)).toEqual({ cap: "x.y", count: 0 });
    expect(await countedCap("x.y", port(Number.NaN), U)).toEqual({ cap: "x.y", count: 0 });
    expect(await countedCap("x.y", port(4.9), U)).toEqual({ cap: "x.y", count: 4 });
  });
});
