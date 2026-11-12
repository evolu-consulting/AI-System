// CR-127 · Kết thúc tạo sẵn phải có kết quả hợp lệ theo app (Community không có approved/rejected/returned).
import { describe, expect, test } from "bun:test";
import { COMMUNITY_MANIFEST } from "@ai/contracts/app-manifest";
import { eventOf } from "./flow-def";
import type { Outline } from "./outline";
import { CONTRACT_OUTCOMES, endOutcomesOf, withDefaultEnds } from "./outline-ends";

describe("endOutcomesOf", () => {
  test("sự kiện vắng / app hợp đồng ⇒ bộ approved|rejected|returned", () => {
    expect(endOutcomesOf(undefined)).toBe(CONTRACT_OUTCOMES);
  });
  test("Community: mọi Kết thúc tạo sẵn dùng kết quả của sự kiện", () => {
    const ev = eventOf("community", COMMUNITY_MANIFEST.events[0]?.key ?? "");
    const keys = new Set(ev?.outcomes.map((o) => o.key));
    const e: Outline = { kind: "outline", items: [], exits: [] };
    const o = withDefaultEnds(e, endOutcomesOf(ev));
    const outs = [...o.items, ...o.exits].map((n) => n.stage.outcome as string);
    expect(outs.length).toBeGreaterThan(0);
    for (const x of outs) expect(keys.has(x)).toBe(true);
  });
});
