// CR-125 · c5 · luật thuần "mẫu dùng được ở công ty chưa".
import { describe, expect, test } from "bun:test";
import { MODULES } from "./index";
import { mapGroupKey, templateNeeds, templateReadiness } from "./template-readiness";

const review = (name: string, group: string) => ({
  key: name,
  name,
  executor: { kind: "approve" },
  after: { kind: "review", group_key: group },
});
const tool = (name: string, key: string) => ({
  key: name,
  name,
  executor: { kind: "tool", tool_key: key },
  after: { kind: "auto" },
});
const none = { features: new Set<string>(), tools: new Set<string>(), groupKeys: [] as string[] };

describe("templateReadiness", () => {
  test("mẫu chỉ có bước lõi ⇒ ready, nhóm thiếu không chặn", () => {
    const n = templateNeeds([review("Duyệt", "community-admin")], MODULES);
    const r = templateReadiness(n, none);
    expect(r.ready).toBe(true);
    expect(r.missing.groups).toEqual(["community-admin"]);
  });
  test("node có tính năng chưa bật ⇒ not ready, nêu tính năng và bước", () => {
    const n = templateNeeds([{ key: "k", name: "Hiện bài", node: "community.show-post" }], MODULES);
    const off = templateReadiness(n, none);
    expect(off.ready).toBe(false);
    expect(off.missing.features).toEqual([{ key: "community-write", stage: "Hiện bài" }]);
    expect(off.reasons[0]).toEqual({
      code: "READINESS_FEATURE_MISSING",
      params: { stage: "Hiện bài", key: "community-write" },
    });
    const on = templateReadiness(n, { ...none, features: new Set(["community-write"]) });
    expect(on.ready).toBe(true);
  });
  test("stage tool không khả dụng ⇒ not ready; khả dụng ⇒ ready", () => {
    const n = templateNeeds([tool("Agent sàng lọc", "community-screen")], MODULES);
    expect(templateReadiness(n, none).missing.tools[0]?.key).toBe("community-screen");
    expect(templateReadiness(n, { ...none, tools: new Set(["community-screen"]) }).ready).toBe(
      true,
    );
  });
  test("bước khe cố định (slot): gán được (ready) nhưng không sao chép sửa được, không đòi tool", () => {
    const n = templateNeeds(
      [{ ...tool("Agent sàng lọc", "community-screen"), slot: { kind: "agent" } }],
      MODULES,
    );
    const r = templateReadiness(n, none);
    expect(r.ready).toBe(true);
    expect(r.missing.tools).toEqual([]);
    expect(r.copyable).toBe(false);
    expect(r.copyReasons[0]).toEqual({
      code: "READINESS_STEP_LOCKED",
      params: { stage: "Agent sàng lọc" },
    });
    expect(r.missing.locked).toEqual(["Agent sàng lọc"]);
  });
});

describe("templateReadiness", () => {
  test("node requires approval đứng không ngay sau Duyệt ⇒ not ready", () => {
    const esign = { key: "e", name: "Ký số", node: "contracts.esign" };
    const bad = templateReadiness(templateNeeds([esign], MODULES), {
      ...none,
      features: new Set(["contracts-write"]),
    });
    expect(bad.missing.order.length).toBe(1);
    const good = templateReadiness(templateNeeds([review("D", "x"), esign], MODULES), {
      ...none,
      features: new Set(["contracts-write"]),
    });
    expect(good.missing.order).toEqual([]);
  });
  test("node nhiều stage (gửi + chờ ký) ⇒ chỉ stage đầu cần Duyệt ngay trước", () => {
    const send = { key: "s", name: "Ký số", node: "contracts.esign" };
    const wait = { key: "w", name: "Chờ ký", node: "contracts.esign" };
    const r = templateReadiness(templateNeeds([review("D", "x"), send, wait], MODULES), {
      ...none,
      features: new Set(["contracts-write"]),
    });
    expect(r.missing.order).toEqual([]);
  });
  test("nhóm: trùng mã, <app>-admin ⇒ <app>-owner, lạ ⇒ chưa có nhóm (không đoán)", () => {
    expect(mapGroupKey("truong-phong", ["truong-phong"])).toBe("truong-phong");
    expect(mapGroupKey("community-admin", ["community-owner", "ketoan"])).toBe("community-owner");
    expect(mapGroupKey("community-admin", ["ketoan"])).toBeNull();
    const r = templateReadiness(templateNeeds([review("D", "community-admin")], MODULES), {
      ...none,
      groupKeys: ["community-owner"],
    });
    expect(r.groupMap).toEqual({ "community-admin": "community-owner" });
    expect(r.missing.groups).toEqual([]);
  });
});
