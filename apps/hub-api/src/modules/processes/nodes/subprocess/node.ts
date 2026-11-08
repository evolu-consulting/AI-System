// CR-125 · node `subprocess` («Quy trình con»): Hub mở MỘT lượt con rồi chờ (stage `waiting_timer`, KHÔNG hẹn giờ) tới khi lượt con kết
// thúc ⇒ trigger 0129 ghi hẹn tới hạn ngay ⇒ vòng hẹn giờ `finishWait` ghi output (`outcome` + `sub_<trường>`). Không agent. Output do Hub
// sinh (ép trường như stage chờ); field `outcome` khai để rẽ (`branches[].on`) / node Nếu đọc. Guard lưu def (có / vòng / sâu) ở
// `defs/subprocess-check.ts` (cần DB). Pha chạy: `nodes/subprocess/launch.ts`.
import { STAGE_TIMEOUT_S } from "@ai/contracts/chat";
import { HANDOFF_SECTION, NODE_FAMILY_OF, SUBPROCESS_OUTCOME_FIELD } from "@ai/contracts/hub-admin";
import type { DefStage, NodeSpec } from "../types";
import { WAIT_STAGE_TEMPLATE } from "../wait-until/wait-stage.rules";

export function ensureSubprocessStage<S extends DefStage>(s: S): S {
  if (s.executor.kind !== "subprocess") return s;
  return {
    ...s,
    output: {
      filename: s.output.filename,
      template: WAIT_STAGE_TEMPLATE,
      required_sections: [HANDOFF_SECTION],
      fields: [{ key: SUBPROCESS_OUTCOME_FIELD, type: "string", required: false }],
    },
    answerer: { kind: "starter" },
    token_budget: null,
    timeout_s: STAGE_TIMEOUT_S.default,
  };
}

export const subprocessNode: NodeSpec<"subprocess"> = {
  kind: "subprocess",
  family: NODE_FAMILY_OF.subprocess,
  produces: "declared",
  realAction: false,
  handoff: false,
  normalize: ensureSubprocessStage,
};
