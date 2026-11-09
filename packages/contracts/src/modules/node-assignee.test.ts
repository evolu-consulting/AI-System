// CR-126 · nhóm phụ trách của node module: cấu hình node ⇒ `after.group_*` của stage form trong cụm; thiếu nhóm ⇒ chưa sẵn sàng.
import { describe, expect, it } from "bun:test";
import { MODULES } from "./index.generated";
import { applyNodeAssignee, nodeAssigneeMessage, nodeAssigneeNeeds } from "./node-assignee";
import { templateNeeds, templateReadiness } from "./template-readiness";

const G = "2f6f6f6f-1111-4222-8333-444455556666";
const approve = {
  key: "duyet",
  name: "Duyệt",
  executor: { kind: "approve" },
  after: { kind: "review", group_id: G },
};
const send = (group?: string) => [
  {
    key: "chon",
    name: "Gửi đối tác xác nhận",
    node: "contracts.partner-send",
    executor: { kind: "form", fields: [] },
    after: { kind: "auto" },
  },
  {
    key: "gui",
    node: "contracts.partner-send",
    executor: {
      kind: "tool",
      tool_key: "contracts-partner-send",
      args: group ? { assignee_group: { from: "const", value: group } } : {},
    },
    after: { kind: "auto" },
  },
  {
    key: "cho",
    node: "contracts.partner-send",
    executor: { kind: "wait_event" },
    after: { kind: "auto" },
  },
];
type S = { after: Record<string, unknown> };

describe("CR-126 · nhóm phụ trách node module", () => {
  it("(a) nhóm cấu hình ở node ⇒ stage form trong cụm giao cho nhóm đó (after review + group_id); stage khác không đổi", () => {
    const out = applyNodeAssignee([approve, ...send(G)], MODULES) as S[];
    expect(out[1]?.after).toMatchObject({ kind: "review", group_id: G });
    expect(out[2]?.after).toEqual({ kind: "auto" });
    expect(out[0]).toBe(approve);
  });

  it("mã nhóm (def Thư viện) ⇒ group_key; đổi cấu hình ⇒ tính lại (không giữ nhóm cũ)", () => {
    const first = applyNodeAssignee(send(G), MODULES);
    const again = applyNodeAssignee([first[0], ...send("contracts-sale").slice(1)], MODULES) as S[];
    expect(again[0]?.after).toMatchObject({
      kind: "review",
      group_id: null,
      group_key: "contracts-sale",
    });
  });

  it("(d) chưa chọn nhóm ⇒ chưa sẵn sàng, câu «Chọn nhóm phụ trách gửi đối tác»", () => {
    const stages = [approve, ...send()];
    const need = nodeAssigneeNeeds(stages, MODULES);
    expect(need).toEqual([
      {
        stage: "Gửi đối tác xác nhận",
        node: "contracts.partner-send",
        group: null,
        label: "Nhóm phụ trách gửi đối tác",
      },
    ]);
    expect(nodeAssigneeMessage(need[0]?.label ?? "")).toBe("Chọn nhóm phụ trách gửi đối tác");
    const tenant = {
      features: new Set(["contracts-partner-confirm"]),
      tools: new Set(["contracts-partner-send"]),
      groupKeys: [],
    };
    const r = templateReadiness(templateNeeds(stages, MODULES), tenant);
    expect(r.ready).toBe(false);
    expect(r.reasons).toContainEqual({
      code: "READINESS_ASSIGNEE_MISSING",
      params: { stage: "Gửi đối tác xác nhận", key: "nhóm phụ trách gửi đối tác" },
    });
  });

  it("mã nhóm không có ở công ty ⇒ chưa sẵn sàng; có ⇒ không vướng lý do nhóm phụ trách", () => {
    const stages = [approve, ...send("contracts-sale")];
    const base = { features: new Set<string>(), tools: new Set<string>() };
    const miss = templateReadiness(templateNeeds(stages, MODULES), { ...base, groupKeys: [] });
    expect(miss.reasons.map((x) => x.code)).toContain("READINESS_ASSIGNEE_MISSING");
    const ok = templateReadiness(templateNeeds(stages, MODULES), {
      ...base,
      groupKeys: ["contracts-sale"],
    });
    expect(ok.reasons.map((x) => x.code)).not.toContain("READINESS_ASSIGNEE_MISSING");
  });
});
