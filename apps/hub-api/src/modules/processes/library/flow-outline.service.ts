// CR-127 · M4 · "các bước HĐ sẽ đi qua" (cho người Gửi HĐ, không cần platform_admin): đọc quy trình ĐANG BẬT khớp sự kiện (CÙNG `candidatesOf` +
// `planEvent` với `hasFlowFor`) rồi đi đường "Duyệt hết" theo dữ kiện hiện tại bằng luật thuần của Chạy thử. Một tx CHỈ ĐỌC, số câu SQL cố
// định (quy trình · mã nhóm · nhóm · người dùng · uỷ quyền), không phụ thuộc số bước/quy trình. Không ghi, không gửi gì.
import type { ProcessStageDef } from "@ai/contracts/hub-admin";
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { FlowOutline } from "../../packs/kit/public";
import type { FactValue } from "../domain/if/if.rules";
import { outlineSteps } from "../domain/preview/flow-outline";
import { bindGroupKeys, groupKeysOf } from "../triggers/group-keys.rules";
import type { FlowCandidate } from "../triggers/match.rules";
import { flowRowsOf, groupIdsByKeyOf, loadWorld } from "./flow-preview.repo";

type Obj = Record<string, unknown>;
/** Id nhóm + người dùng mà các bước Duyệt nhắc tới (sau khi đổi mã nhóm → id). */
function refsOf(stages: readonly ProcessStageDef[]) {
  const groupIds: string[] = [];
  const userIds: string[] = [];
  for (const s of stages) {
    const a = s.after as unknown as Obj;
    const esc = (a.escalate ?? null) as Obj | null;
    for (const g of [a.group_id, esc?.group_id]) if (typeof g === "string") groupIds.push(g);
    for (const u of [a.approver_user_id, esc?.user_id]) if (typeof u === "string") userIds.push(u);
  }
  return { groupIds, userIds };
}

const MAX_FLOWS = 5;

export async function outlineOfRun(
  db: Db,
  q: { tenantId: string; facts: Record<string, unknown> },
  run: readonly FlowCandidate[],
  starterId: string,
  at: Date = new Date(),
): Promise<FlowOutline | null> {
  if (run.length === 0) return null;
  const picked = run.slice(0, MAX_FLOWS);
  return withHubScope(
    db,
    { kind: "system" },
    async (tx) => {
      const rows = await flowRowsOf(
        tx,
        q.tenantId,
        picked.map((c) => c.flowId),
      );
      const raws = picked.flatMap((c) => {
        const r = rows.get(c.flowId);
        return r ? [{ name: r.name, stages: r.stages as ProcessStageDef[] }] : [];
      });
      const ids = await groupIdsByKeyOf(tx, q.tenantId, groupKeysOf(raws.flatMap((x) => x.stages)));
      const flows = raws.map((x) => ({
        name: x.name,
        stages: bindGroupKeys(x.stages, ids).stages as ProcessStageDef[],
      }));
      const refs = refsOf(flows.flatMap((f) => f.stages));
      const world = await loadWorld(tx, q.tenantId, {
        groupIds: refs.groupIds,
        userIds: [...refs.userIds, starterId],
        at,
      });
      const steps = flows.flatMap((f) =>
        outlineSteps({
          stages: f.stages,
          facts: q.facts as Record<string, FactValue>,
          starterId,
          at,
          world,
          factLabels: new Map(),
          outcomes: [],
        }),
      );
      return { flowName: flows.map((f) => f.name).join(" + "), steps };
    },
    { accessMode: "read only" },
  );
}
