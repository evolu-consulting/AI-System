// CR-125 · c5 · mẫu "Quản trị duyệt bài": FlowDef hợp lệ với sự kiện post.created và KHÔNG đòi gì thêm ngoài nhóm chủ gói (D7).
import { describe, expect, it } from "bun:test";
import { COMMUNITY_MANIFEST } from "@ai/contracts/app-manifest";
import { flowDefIssues, parseFlowDef } from "@ai/contracts/hub-admin";
import { MODULES, templateNeeds, templateReadiness } from "@ai/contracts/modules";
import { communityFlowDef } from "./flow-templates.community";

describe("CR-125 c5 · mẫu Community", () => {
  const def = communityFlowDef();

  it("FlowDef mới hợp lệ, không lỗi theo sự kiện post.created", () => {
    const p = parseFlowDef(def);
    expect(p.ok && !p.legacy).toBe(true);
    expect(flowDefIssues(def, COMMUNITY_MANIFEST.events)).toEqual([]);
  });

  it("công ty chỉ có nhóm chủ gói ⇒ dùng được ngay, nhóm duyệt khớp contracts-owner", () => {
    const r = templateReadiness(templateNeeds(def.stages, MODULES), {
      features: new Set(),
      tools: new Set(),
      groupKeys: ["contracts-owner"],
    });
    expect(r.ready).toBe(true);
    expect(r.groupMap).toEqual({ "contracts-admin": "contracts-owner" });
  });
});
