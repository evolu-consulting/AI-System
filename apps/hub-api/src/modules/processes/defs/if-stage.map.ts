// CR-103 · fnr-if: mapper stage contract (snake_case) → `IfStageShape` domain (`step` đã chuẩn hoá). Dùng cho luật def của node If
// và test parity (file ngoài `nodes/` không import `nodes/<kind>/*`).
import type { ProcessDefInput } from "@ai/contracts/hub-admin";
import type { IfCond, IfStageShape } from "../domain/if/if.rules";

type DefStage = ProcessDefInput["stages"][number];
/** Mapper contract (snake_case) → domain (`step` đã chuẩn hoá). */
export function toIfStage(s: DefStage, step: number): IfStageShape {
  const ex = s.executor;
  return {
    key: s.key,
    step,
    realAction: s.real_action,
    afterKind: s.after.kind === "review" ? "review" : "auto",
    fields: s.output.fields,
    ifExec:
      ex.kind === "if"
        ? {
            when: {
              op: ex.when.op,
              conds: ex.when.conds.map(
                (c): IfCond => ({
                  from:
                    c.from.kind === "field"
                      ? { kind: "field", stageKey: c.from.stage_key, field: c.from.field }
                      : c.from,
                  op: c.op,
                  value: c.value,
                }),
              ),
            },
            thenStep: ex.then_step,
            elseStep: ex.else_step,
          }
        : null,
  };
}
