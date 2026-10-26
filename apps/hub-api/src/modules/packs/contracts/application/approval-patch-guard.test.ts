// fix-review · luật sửa trường của lượt engine: chỉ sửa được khi bước mở là s0 (soạn / đã Trả lại); bước sau ⇒ khoá; máy cũ như cũ.
import { describe, expect, it } from "bun:test";
import { patchGuard } from "./approval.usecase";

const who = { tenantId: "t", userId: "u" };
const guard = (o: { status: string | null; run: string | null; open: number | null | "nocard" }) =>
  patchGuard({
    uow: {
      tenant: async (_w: unknown, fn: (r: unknown) => unknown) =>
        fn({ approval: { statusOf: async () => o.status, engineRunOf: async () => o.run } }),
    },
    ...(o.open === "nocard" ? {} : { card: { openStepIdx: async () => o.open } }),
  } as never);

describe("patchGuard · lượt engine", () => {
  it("máy cũ: level1 sửa được, level2 khoá", async () => {
    expect(await guard({ status: "level1", run: null, open: 0 }).phase(who, "r")).toBe("level1");
    expect(await guard({ status: "level2", run: null, open: 0 }).phase(who, "r")).toBe("later");
  });
  it("engine: bước mở s0 ⇒ sửa được; bước ≥ 1 / không bước mở / không có cổng ⇒ khoá", async () => {
    expect(await guard({ status: "level1", run: "x", open: 0 }).phase(who, "r")).toBe("level1");
    expect(await guard({ status: "level1", run: "x", open: 1 }).phase(who, "r")).toBe("later");
    expect(await guard({ status: "level1", run: "x", open: null }).phase(who, "r")).toBe("later");
    expect(await guard({ status: "level1", run: "x", open: "nocard" }).phase(who, "r")).toBe(
      "later",
    );
  });
});
