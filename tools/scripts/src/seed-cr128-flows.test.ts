// CR-141 · quy trình demo «Duyệt hợp đồng» qua validator def THẬT (không chờ staging): If không nhảy tới bước hành động thật, Ký đứng sau bước duyệt,
// mọi đường vào Ký đi từ một bước duyệt.
import { describe, expect, it } from "bun:test";
import { ProcessDefInputBaseSchema } from "@ai/contracts/hub-admin";
import { validateProcessDef } from "../../../apps/hub-api/src/modules/processes/defs/def.rules";
import { contractStages } from "./seed-cr128-flows";

const refs = {
  agentIds: new Set<string>(),
  teamIds: new Set<string>(),
  groupIds: new Set<string>(),
  userIds: new Set<string>(),
};
type St = {
  key: string;
  step: number;
  node?: string;
  real_action: boolean;
  after: { kind: string };
  executor: { kind: string; next_step?: number };
};

describe("CR-141 · seed «Duyệt hợp đồng»", () => {
  const stages = contractStages() as St[];
  it("qua validator def: không có lỗi cấu trúc (PROCESS_DEF_INVALID)", () => {
    const d = ProcessDefInputBaseSchema.parse({
      key: "duyet-hop-dong",
      name: "Duyệt hợp đồng",
      description: "",
      input_hint: "",
      run_group_ids: [],
      stages,
      token_budget: null,
      enabled: false,
    });
    const r = validateProcessDef(d as never, refs as never);
    expect(r.ok ? "ok" : r.code).not.toBe("PROCESS_DEF_INVALID");
  });
  it("bước Ký hợp đồng có đúng một bước ngay trước và đó là bước duyệt (cả hai nhánh)", () => {
    const sign = stages.find((s) => s.node === "contracts.esign" && s.real_action) as St;
    const before = stages.filter((s) => s.step === sign.step - 1);
    expect(before.every((s) => s.after.kind === "review")).toBe(true);
    expect(sign.step).toBe(4);
    const star = stages.filter((s) => s.after.kind === "review").map((s) => s.key);
    expect(star).toEqual(["truong-phong", "giam-doc", "truong-phong-duoi-500"]);
  });
});
