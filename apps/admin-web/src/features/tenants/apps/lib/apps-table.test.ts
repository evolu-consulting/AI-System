// CR-121 c12 · R3 · "x bật · y tắt", dải Cần xử lý, trạng thái + lý do của hàng app.
import { describe, expect, it } from "bun:test";
import type { FlowGroup, FlowJob } from "../../flows/lib/flow-rows";
import { appsOnCount, attentionOf, flowCounts, rowStatus } from "./apps-table";

const job = (slot: string, status: "on" | "off"): FlowJob => ({
  slot,
  app: slot.split(".")[0] ?? "",
  defId: status === "on" ? "d" : null,
  defName: null,
  version: null,
  status,
  reason: status === "off" ? "noProcess" : null,
  rules: 0,
  routingLoaded: true,
});
const groups: FlowGroup[] = [
  { app: "contracts", jobs: [job("contracts.approval", "on"), job("contracts.intake", "on")] },
  {
    app: "community",
    jobs: [
      job("community.report", "on"),
      job("community.partner-join", "on"),
      job("community.post-moderation", "off"),
    ],
  },
];

describe("CR-121 c12 · flowCounts", () => {
  it('"2 bật · 1 tắt" theo app', () => {
    const m = flowCounts(groups);
    expect(m.get("contracts")).toEqual({ on: 2, off: 0 });
    expect(m.get("community")).toEqual({ on: 2, off: 1 });
    expect(m.get("chat")).toBeUndefined();
  });
});

describe("CR-121 c12 · attentionOf (dải Cần xử lý, Q5)", () => {
  it("1 dòng cho Duyệt bài của Community khi app đang bật; app tắt thì ẩn; gán xong thì hết", () => {
    expect(attentionOf(groups, () => true)).toEqual([
      { app: "community", slot: "community.post-moderation" },
    ]);
    expect(attentionOf(groups, (a) => a !== "community")).toEqual([]);
    const fixed = groups.map((g) => ({
      ...g,
      jobs: g.jobs.map((j) => ({ ...j, status: "on" as const })),
    }));
    expect(attentionOf(fixed, () => true)).toEqual([]);
  });
});

describe("CR-121 c12 · rowStatus", () => {
  const lv = (consistent = true) => ({ level: "write" as const, consistent });
  it("Cơ bản luôn bật; app Tắt; quyền không chuẩn; còn việc chưa gán; đang bật", () => {
    expect(rowStatus({ mode: "core" }, null, true, [])).toEqual({ kind: "on", always: true });
    expect(rowStatus({ mode: "levels" }, lv(), false, [])).toEqual({ kind: "off" });
    expect(rowStatus({ mode: "levels" }, lv(false), true, [])).toEqual({ kind: "nonstandard" });
    expect(
      rowStatus({ mode: "levels" }, lv(), true, [{ app: "community", slot: "community.x" }]),
    ).toEqual({
      kind: "attention",
      slot: "community.x",
    });
    expect(rowStatus({ mode: "levels" }, lv(), true, [])).toEqual({ kind: "on" });
  });
});

describe("CR-121 f11 · appsOnCount (một cách đếm)", () => {
  const card = (app: string, mode: string, keys: string[] = []) =>
    ({
      app,
      mode,
      levelFeatures: { read: keys[0] ? { key: keys[0] } : undefined },
      addons: [],
      main: undefined,
    }) as never;
  it("Cơ bản (luôn bật) không tính; y = số ứng dụng chọn được", () => {
    const cards = [
      card("core", "core"),
      card("contracts", "levels", ["contracts-read"]),
      card("community", "levels", ["community-read"]),
    ];
    expect(appsOnCount(cards, new Set(["contracts-read"]))).toEqual({ on: 1, total: 2 });
    expect(appsOnCount(cards, new Set())).toEqual({ on: 0, total: 2 });
  });
});
