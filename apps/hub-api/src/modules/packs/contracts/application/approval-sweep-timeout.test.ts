// CR-155 · hạn đọc của AI: vòng quét chuyển cho repo hạn 180 s mặc định (hoặc giá trị cấu hình) ⇒ HĐ `reading` quá hạn ⇒ `TIMEOUT`.
import { describe, expect, it } from "bun:test";
import type { SweepOptions, SweepRepo } from "./approval.ports";
import { EXTRACT_READ_TIMEOUT_S, type SweepDeps, sweepApprovalsOnce } from "./approval-sweep";

const T = "00000000-0000-4000-8000-0000000000a1";

async function seen(over: Partial<SweepDeps> = {}): Promise<SweepOptions> {
  let got: SweepOptions | null = null;
  const repo = {
    sweep: async (o: SweepOptions) => {
      got = o;
      return { read: 0, closed: 0, healed: 0 };
    },
  } as unknown as SweepRepo;
  await sweepApprovalsOnce({
    uow: { system: async (_t, fn) => fn({ sweep: repo }) },
    tenants: async () => [T],
    ...over,
  });
  if (!got) throw new Error("sweep not called");
  return got;
}

describe("CR-155 · hạn đọc AI của vòng quét", () => {
  it("mặc định 3 phút (180 s)", async () => {
    expect(EXTRACT_READ_TIMEOUT_S).toBe(180);
    expect((await seen()).readTimeoutSeconds).toBe(180);
  });
  it("cấu hình được; hạn đọc nhỏ hơn hạn STALE mặc định (15') ⇒ TIMEOUT thắng STALE", async () => {
    const o = await seen({ readTimeoutS: 60 });
    expect(o.readTimeoutSeconds).toBe(60);
    expect(o.readTimeoutSeconds ?? 0).toBeLessThan(o.staleMinutes * 60);
  });
});
