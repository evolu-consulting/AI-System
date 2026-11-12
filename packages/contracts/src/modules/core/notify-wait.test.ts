// CR-127 · E9 · R#39 · node gộp Thông báo / Chờ: cấu hình ⇄ executor, ánh xạ khoá cũ, sổ module không lỗi.
import { describe, expect, test } from "bun:test";
import { baseNodeOf, featureNodeByKey, MODULES, moduleIssues } from "../index";
import {
  canonicalCoreNode,
  NotifyConfigSchema,
  notifyConfigOf,
  notifyExecutorOf,
  WaitConfigSchema,
  waitConfigOf,
  waitExecutorOf,
} from "./notify-wait";

describe("core.notify", () => {
  test("executor ⇄ cấu hình: chuông / email / cả hai, tiêu đề + nội dung", () => {
    const ex = {
      kind: "notify" as const,
      to: [{ who: "starter" as const }],
      channels: ["bell", "email"] as ("bell" | "email")[],
      title: "Đã duyệt",
      body: "Hợp đồng đã được duyệt",
    };
    const c = notifyConfigOf(ex);
    expect(c).toEqual({ channel: "both", to: ex.to, text: "Đã duyệt\nHợp đồng đã được duyệt" });
    expect(NotifyConfigSchema.safeParse(c).success).toBe(true);
    expect(notifyExecutorOf(c)).toEqual(ex);
    expect(notifyConfigOf({ ...ex, channels: ["email"], body: "" }).channel).toBe("email");
    expect(notifyConfigOf({ ...ex, channels: ["bell"] }).channel).toBe("bell");
    expect(notifyExecutorOf({ channel: "email", to: [], text: "x" }).channels).toEqual(["email"]);
  });
});

describe("core.wait", () => {
  test("tới ngày ⇄ wait_until, khoảng ⇄ wait_for", () => {
    const until = {
      kind: "wait_until" as const,
      from: { kind: "input" as const, key: "han_ky" },
      offset_days: -3,
      time: "09:00",
    };
    const c = waitConfigOf(until);
    expect(WaitConfigSchema.safeParse(c).success).toBe(true);
    expect(waitExecutorOf(c)).toEqual(until);
    expect(waitConfigOf({ kind: "wait_for", hours: 48 })).toEqual({ duration_h: 48 });
    expect(waitExecutorOf({ duration_h: 48 })).toEqual({ kind: "wait_for", hours: 48 });
    expect(WaitConfigSchema.safeParse({ duration_h: 0 }).success).toBe(false);
  });
});

describe("ánh xạ node cũ ⇒ mới", () => {
  test("khoá cũ ⇒ khoá gộp; khoá khác giữ nguyên; khoá cũ vẫn còn trong sổ", () => {
    expect(canonicalCoreNode("core.bell")).toBe("core.notify");
    expect(canonicalCoreNode("core.email")).toBe("core.notify");
    expect(canonicalCoreNode("core.wait-until")).toBe("core.wait");
    expect(canonicalCoreNode("core.wait-for")).toBe("core.wait");
    expect(canonicalCoreNode("core.approve")).toBe("core.approve");
    for (const k of ["core.bell", "core.email", "core.wait-until", "core.wait-for"])
      expect(featureNodeByKey(MODULES, k)?.stages).toEqual([]);
  });
  test("def cũ không có stage.node khớp node gộp; node mới vào menu nghiệp vụ, Quy trình con ở Nâng cao", () => {
    expect(baseNodeOf(MODULES, { executor: { kind: "wait_for" } })?.key).toBe("core.wait");
    expect(featureNodeByKey(MODULES, "core.notify")?.menu?.section).toBe("business");
    expect(featureNodeByKey(MODULES, "core.wait")?.menu?.section).toBe("business");
    expect(featureNodeByKey(MODULES, "core.subprocess")?.menu?.section).toBe("advanced");
  });
  test("moduleIssues: node gộp không sinh lỗi khi binding ghi sent_to", () => {
    const nodes = new Map(
      MODULES.flatMap((m) => m.nodes)
        .filter((n) => n.kind === "base")
        .map((n) => [n.key, { tools: [], outputs: n.outputs.map((o) => o.key) }] as const),
    );
    const issues = moduleIssues(
      MODULES.filter((m) => m.app === "core"),
      {
        nodes,
        tools: new Set(),
        facts: new Set(),
        outcomes: new Set(),
      },
    );
    expect(issues).toEqual([]);
  });
});
