// CR-125 · c5b · luật hiển thị readiness: thiếu gì, nút sửa nào, có bấm tiếp được không.
import { describe, expect, it } from "bun:test";
import type { TemplateReadiness } from "@ai/contracts/modules";
import { ApiError } from "@/lib/http";
import {
  canProceed,
  featureParts,
  fixErrorKey,
  isBlocking,
  loadErrorKey,
  readinessItems,
} from "./readiness-view";

const base: TemplateReadiness = {
  ready: true,
  missing: { features: [], tools: [], groups: [], order: [], locked: [] },
  groupMap: {},
  reasons: [],
  copyable: true,
  copyReasons: [],
};

describe("readiness-view", () => {
  it("mẫu dùng được ⇒ không mục nào, bấm tiếp được cả gán lẫn sao chép", () => {
    expect(readinessItems(base, false)).toEqual([]);
    expect(canProceed(base, false) && canProceed(base, true)).toBe(true);
  });
  it("thiếu tính năng ⇒ nút bật tính năng; thiếu nhóm ⇒ nút tạo nhóm nhưng KHÔNG chặn", () => {
    const r: TemplateReadiness = {
      ...base,
      ready: false,
      copyable: false,
      missing: {
        ...base.missing,
        features: [{ key: "community-write", stage: "Hiện bài" }],
        groups: ["community-admin"],
      },
    };
    const items = readinessItems(r, false);
    expect(items.map((i) => [i.kind, i.fix])).toEqual([
      ["feature", "enable-feature"],
      ["group", "create-group"],
    ]);
    expect(items.filter(isBlocking).map((i) => i.kind)).toEqual(["feature"]);
    expect(canProceed(r, false)).toBe(false);
  });
  it("chỉ thiếu nhóm ⇒ vẫn gán/sao chép được", () => {
    const r: TemplateReadiness = { ...base, missing: { ...base.missing, groups: ["g"] } };
    expect(canProceed(r, false) && canProceed(r, true)).toBe(true);
  });
  it("bước cố định của nền tảng ⇒ gán được nhưng sao chép bị chặn, mục 'locked' chỉ hiện khi sao chép", () => {
    const r: TemplateReadiness = {
      ...base,
      copyable: false,
      missing: { ...base.missing, locked: ["Agent sàng lọc"] },
      copyReasons: [{ code: "READINESS_STEP_LOCKED", params: { stage: "Agent sàng lọc" } }],
    };
    expect(readinessItems(r, false)).toEqual([]);
    expect(readinessItems(r, true)).toEqual([
      { kind: "locked", key: "", stage: "Agent sàng lọc", fix: null },
    ]);
    expect(canProceed(r, false)).toBe(true);
    expect(canProceed(r, true)).toBe(false);
  });
});

describe("readiness-view", () => {
  it("lỗi tải / lỗi nút sửa ⇒ khoá theo mã, mã lạ ⇒ default", () => {
    expect(loadErrorKey(new ApiError(403, "FORBIDDEN", "x"))).toBe(
      "tenants.companyFlows.readiness.loadFailed.FORBIDDEN",
    );
    expect(loadErrorKey(Object.assign(new Error("x"), { code: "HUB_UNCONFIGURED" }))).toBe(
      "tenants.companyFlows.readiness.loadFailed.HUB_UNCONFIGURED",
    );
    expect(loadErrorKey(new Error("boom"))).toBe(
      "tenants.companyFlows.readiness.loadFailed.default",
    );
    expect(fixErrorKey(new ApiError(422, "FEATURE_NOT_NEEDED", "x"))).toBe(
      "tenants.companyFlows.readiness.fixError.FEATURE_NOT_NEEDED",
    );
    expect(fixErrorKey(new ApiError(500, "WHAT", "x"))).toBe(
      "tenants.companyFlows.readiness.fixError.default",
    );
  });
  it("tool thiếu không có nút sửa; featureParts tách app + mức", () => {
    const r: TemplateReadiness = {
      ...base,
      ready: false,
      missing: { ...base.missing, tools: [{ key: "x-y", stage: "B" }] },
    };
    expect(readinessItems(r, false)[0]).toMatchObject({ kind: "tool", fix: null });
    expect(featureParts("community-write")).toEqual({ app: "community", level: "write" });
    expect(featureParts("han-muc-duyet")).toEqual({ app: "han-muc-duyet", level: "" });
  });
});
