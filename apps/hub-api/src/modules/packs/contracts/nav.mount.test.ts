// CR-127 U6 · nguồn nav Sổ Hợp Tác: chỉ còn mục duyệt (`contracts.partner` gỡ); `countedCap` của kit vẫn được test ở đây.
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

describe("contractsNavSource · CR-127 U6 (đã gỡ cap contracts.partner)", () => {
  it("chỉ còn mục duyệt; không còn mục «đối tác gửi»", async () => {
    const s = contractsNavSource(async () => true, runs(2));
    expect(await s.caps(U)).toEqual([{ cap: "contracts.review", count: 2 }]);
  });

  it("không có quyền đọc ⇒ không mục", async () => {
    const s = contractsNavSource(async () => false, runs(2));
    expect(await s.caps(U)).toEqual([]);
  });

  it("không có cầu duyệt ⇒ không mục", async () => {
    const s = contractsNavSource(async () => true, undefined);
    expect(await s.caps(U)).toEqual([]);
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
