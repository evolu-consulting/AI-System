// CR-105 · L1 · design §1 · viết TRƯỚC code: def thư viện (`tenant_id NULL` + `slot`) trỏ Group CHỈ bằng mã (`*_key`) — id ⇒ 422
// `PROCESS_REF_INVALID` (ngăn rò id Group tenant A sang B); def tenant CHỈ bằng id (mã ⇒ cùng lỗi).
import { describe, expect, it } from "bun:test";
import { type ProcessDefInput, ProcessDefInputBaseSchema } from "@ai/contracts/hub-admin";
import { type DefCheck, validateProcessDef } from "./def.rules";
import type { DefRefs } from "./def-refs";

const AG = "0b8e8c2e-1f0a-4c55-9a51-000000000001";
const G = "0b8e8c2e-1f0a-4c55-9a51-0000000000a1";
const G2 = "0b8e8c2e-1f0a-4c55-9a51-0000000000a2";
const refs: DefRefs = {
  agentIds: new Set([AG]),
  teamIds: new Set(),
  groupIds: new Set([G, G2]),
  userIds: new Set(),
};

function def(after: Record<string, unknown>, o: Record<string, unknown> = {}): ProcessDefInput {
  const stage = {
    key: "s0",
    name: "Duyệt",
    executor: { kind: "agent", agent_id: AG },
    instruction: "",
    output: { filename: "s0.md", template: "## A", required_sections: ["A"], fields: [] },
    after: { kind: "review", group_id: null, ...after },
    real_action: false,
    answerer: { kind: "starter" },
    token_budget: null,
  };
  return ProcessDefInputBaseSchema.parse({
    key: "pl-keys",
    name: "Thư viện",
    description: "",
    input_hint: "",
    run_group_ids: [],
    stages: [stage],
    token_budget: null,
    enabled: false,
    ...o,
  }) as ProcessDefInput;
}
const lib = { library: true } as const;
const refInvalid = (path: string): DefCheck => ({
  ok: false,
  code: "PROCESS_REF_INVALID",
  path,
  ref: "group",
});

describe("CR-105 · Group theo mã trong def thư viện", () => {
  it("def thư viện dùng id Group ⇒ PROCESS_REF_INVALID", () => {
    expect(validateProcessDef(def({ group_id: G }), refs, lib)).toEqual(
      refInvalid("stages.0.after.group_id"),
    );
    expect(
      validateProcessDef(
        def({ group_key: "ke-toan", escalate: { after_h: 24, group_id: G2 } }),
        refs,
        lib,
      ),
    ).toEqual(refInvalid("stages.0.after.escalate.group_id"));
    expect(
      validateProcessDef(def({ group_key: "ke-toan", also_group_ids: [G2] }), refs, lib),
    ).toEqual(refInvalid("stages.0.after.also_group_ids.0"));
    expect(
      validateProcessDef(def({ group_key: "ke-toan" }, { run_group_ids: [G] }), refs, lib),
    ).toEqual(refInvalid("run_group_ids.0"));
  });

  it("def thư viện chỉ dùng mã ⇒ hợp lệ (mã không kiểm theo tenant lúc lưu); bật mà review thiếu cả mã ⇒ INCOMPLETE", () => {
    const keyed = def(
      {
        group_key: "ke-toan",
        also_group_keys: ["giam-doc"],
        escalate: { after_h: 24, group_key: "giam-doc" },
      },
      { run_group_keys: ["kinh-doanh"] },
    );
    expect(validateProcessDef(keyed, refs, lib)).toEqual({ ok: true });
    expect(validateProcessDef({ ...keyed, enabled: true }, refs, lib)).toEqual({ ok: true });
    expect(validateProcessDef(def({}, { enabled: true }), refs, lib)).toEqual({
      ok: false,
      code: "PROCESS_DEF_INCOMPLETE",
      paths: ["stages.0.after.group_id"],
    });
  });

  it("def tenant dùng mã Group ⇒ PROCESS_REF_INVALID; dùng id như cũ ⇒ hợp lệ", () => {
    expect(validateProcessDef(def({ group_key: "ke-toan" }), refs)).toEqual(
      refInvalid("stages.0.after.group_key"),
    );
    expect(
      validateProcessDef(def({ group_id: G }, { run_group_keys: ["kinh-doanh"] }), refs),
    ).toEqual(refInvalid("run_group_keys.0"));
    expect(
      validateProcessDef(def({ group_id: G, escalate: { after_h: 24, group_id: G2 } }), refs),
    ).toEqual({ ok: true });
  });

  it("escalate phải có đúng một trong group_id / group_key (hình dạng)", () => {
    expect(() => def({ group_id: G, escalate: { after_h: 24 } })).toThrow();
    expect(() =>
      def({ group_id: G, escalate: { after_h: 24, group_id: G2, group_key: "giam-doc" } }),
    ).toThrow();
  });
});
