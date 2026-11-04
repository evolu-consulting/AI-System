// dlc-agent-flows · chọn nguồn quy trình khi `dlc-start` mở lượt: agent chỉ định def thư viện ⇒ def đó; không ⇒ tenant như cũ.
import { describe, expect, it } from "bun:test";
import type { ResolvedSlot } from "../../kit/application/slot.ports";
import { slotSourceOf } from "./start-flow.usecase";

const lib = (name: string): ResolvedSlot => ({ defId: name, name, relVersion: 1, slotBody: {} });
function fakePort(defs: Record<string, ResolvedSlot> = {}) {
  const calls: string[] = [];
  return {
    calls,
    resolveSlot: async (t: string, slot: string) => {
      calls.push(`tenant ${t} ${slot}`);
      return lib("tenant");
    },
    resolveSlotDef: async (slot: string, key: string) => {
      calls.push(`def ${slot} ${key}`);
      return defs[`${slot}|${key}`] ?? null;
    },
  };
}

describe("dlc-agent-flows · slotSourceOf", () => {
  it("agent không chỉ định (vắng / dây chuyền khác) ⇒ quy trình của tenant", async () => {
    const p = fakePort();
    expect((await slotSourceOf(p, "t1", "bug-fix", null))?.name).toBe("tenant");
    expect((await slotSourceOf(p, "t1", "bug-fix", { enhancement: "enh" }))?.name).toBe("tenant");
    expect(p.calls).toEqual(["tenant t1 dlc.bug-fix", "tenant t1 dlc.bug-fix"]);
  });
  it("agent chỉ định ⇒ def thư viện đó của đúng khe, không tra tenant", async () => {
    const p = fakePort({ "dlc.enhancement|enh-fast": lib("Nhanh") });
    const r = await slotSourceOf(p, "t1", "enhancement", { enhancement: "enh-fast" });
    expect(r?.name).toBe("Nhanh");
    expect(p.calls).toEqual(["def dlc.enhancement enh-fast"]);
  });
  it("def chỉ định không còn bản xuất bản ⇒ lỗi rõ, không rơi về tenant", async () => {
    const p = fakePort();
    await expect(slotSourceOf(p, "t1", "new-system", { "new-system": "mat" })).rejects.toThrow(
      /mat/,
    );
    expect(p.calls).toEqual(["def dlc.new-system mat"]);
  });
});
