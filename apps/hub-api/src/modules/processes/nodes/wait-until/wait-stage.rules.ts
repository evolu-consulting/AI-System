// HUB-FR-144 · PD-R17 · readiness #7 · plan-contract §3 · plan-addendum A3: Hub ÉP trường của stage `wait_until` khi lưu
// def (output do Hub sinh — `waitOutputMd`): `required_sections=["Bàn giao"]`, template cố định, `output.fields=[]`,
// `answerer=starter`, `token_budget=null`, `timeout_s` mặc định. `filename` giữ. Thuần, idempotent; stage khác giữ nguyên.
import { STAGE_TIMEOUT_S } from "@ai/contracts/chat";
import { HANDOFF_SECTION, type ProcessDefInput } from "@ai/contracts/hub-admin";

type Stage = ProcessDefInput["stages"][number];

/** Template cố định (khoá ở test PD-I36); `{name}` để nguyên — .md thật do Hub dựng theo tên stage lúc chạy. */
export const WAIT_STAGE_TEMPLATE = `# {name}\n\n## ${HANDOFF_SECTION}\n`;

export function ensureWaitStage<S extends Stage>(s: S): S {
  if (s.executor.kind !== "wait_until") return s;
  return {
    ...s,
    output: {
      filename: s.output.filename,
      template: WAIT_STAGE_TEMPLATE,
      required_sections: [HANDOFF_SECTION],
      fields: [],
    },
    answerer: { kind: "starter" },
    token_budget: null,
    timeout_s: STAGE_TIMEOUT_S.default,
  };
}
