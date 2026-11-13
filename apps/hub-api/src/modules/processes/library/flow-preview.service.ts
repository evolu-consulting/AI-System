// CR-127 · E7 · BR-17 · `Chạy thử` quy trình (platform_admin): đọc dữ liệu thật của công ty (một tx CHỈ ĐỌC) rồi đi đường bằng luật thuần
// (`domain/preview/*`). Không ghi hàng nào, không gửi thông báo, không ghi chữ ký — int chứng minh số hàng run/task/notice/evidence/HĐ không đổi.
import { APP_MANIFESTS } from "@ai/contracts/app-manifest";
import type { ProcessStageDef } from "@ai/contracts/hub-admin";
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { withPackScope } from "@ai/db/pack-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import type { FactValue } from "../domain/if/if.rules";
import { ESIGN_NODE } from "../domain/preview/flow-preview.rules";
import { type Scenario, scenariosOf } from "../domain/preview/flow-preview.scenarios";
import {
  type Decision,
  type OutcomeDecl,
  type PreviewInput,
  type PreviewResult,
  walkFlow,
} from "../domain/preview/flow-preview.walk";
import { bindGroupKeys, groupKeysOf } from "../triggers/group-keys.rules";
import { esignOnOf, flowRowOf, groupIdsByKeyOf, loadWorld } from "./flow-preview.repo";
import { tenantOf } from "./slot-assign.repo";

const EVENTS = new Map(
  Object.values(APP_MANIFESTS).flatMap((m) => m.events.map((e) => [e.key, e] as const)),
);

export type PreviewRequest = {
  flow_id?: string | undefined;
  draft?: { event?: string | null | undefined; stages: ProcessStageDef[] } | undefined;
  facts: Record<string, FactValue>;
  starter_user_id?: string | null | undefined;
  decisions?: Decision[] | undefined;
  at?: string | undefined;
};

type Obj = Record<string, unknown>;
/** Id nhóm + người dùng mà các bước nhắc tới (sau khi đổi mã nhóm → id): phòng duyệt, chuyển cấp, người duyệt cụ thể. */
function refsOf(stages: readonly ProcessStageDef[]): { groupIds: string[]; userIds: string[] } {
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

export class FlowPreviewService {
  constructor(private readonly db: Db) {}

  /** Chạy thử MỘT lần với dữ kiện + chuỗi quyết định đã cho. */
  async run(
    u: AuthUser,
    tid: string,
    b: PreviewRequest,
  ): Promise<PreviewResult & { event: string | null }> {
    const { input, event } = await this.#load(u, tid, b);
    return { ...walkFlow({ ...input, decisions: b.decisions ?? [] }), event };
  }

  /** "Chạy cả 4 trường hợp" (Duyệt hết Đúng/Sai · Từ chối · Trả lại). */
  async scenarios(
    u: AuthUser,
    tid: string,
    b: PreviewRequest,
  ): Promise<{ event: string | null; scenarios: Scenario[] }> {
    const { input, event } = await this.#load(u, tid, b);
    return { event, scenarios: scenariosOf(input) };
  }

  async #load(u: AuthUser, tid: string, b: PreviewRequest) {
    if (u.role !== "platform_admin") throw appError("FORBIDDEN");
    const at = b.at ? new Date(b.at) : new Date();
    const r = await withHubScope(this.db, { kind: "system" }, (tx) => loadInput(tx, tid, b, at), {
      accessMode: "read only", // Chạy thử không ghi gì
    });
    // CR-138b: chỉ khi quy trình có bước Ký số mới hỏi công ty đã bật ký số chưa (đọc bảng gói bằng role gói).
    if (r.input.stages.some((s) => s.node === ESIGN_NODE)) {
      const esignOn = await withPackScope(
        this.db,
        { packKey: "contracts", tenantId: tid, userId: null },
        (tx) => esignOnOf(tx, tid),
      );
      r.input.world = { ...r.input.world, esignOn };
    }
    return r;
  }
}

const actorsOf = (b: PreviewRequest): string[] => [
  ...(b.starter_user_id ? [b.starter_user_id] : []),
  ...(b.decisions ?? []).flatMap((d) => (d.actor_user_id ? [d.actor_user_id] : [])),
];

/** Một tx đọc: quy trình (đã lưu hoặc nháp) + nhóm + người dùng ⇒ đầu vào của `walkFlow`. */
async function loadInput(tx: Tx, tid: string, b: PreviewRequest, at: Date) {
  if (!(await tenantOf(tx, tid))) throw appError("NOT_FOUND");
  const row = b.flow_id ? await flowRowOf(tx, tid, b.flow_id) : null;
  if (b.flow_id && !row) throw appError("NOT_FOUND");
  const raw = (row?.stages ?? b.draft?.stages ?? []) as ProcessStageDef[];
  const event = row?.event ?? b.draft?.event ?? null;
  const ids = await groupIdsByKeyOf(tx, tid, groupKeysOf(raw));
  const stages = bindGroupKeys(raw, ids).stages as ProcessStageDef[];
  const refs = refsOf(stages);
  const world = await loadWorld(tx, tid, {
    groupIds: refs.groupIds,
    userIds: [...refs.userIds, ...actorsOf(b)],
    at,
  });
  const ev = event ? EVENTS.get(event) : undefined;
  const outcomes: OutcomeDecl[] = (ev?.outcomes ?? []).map((o) => ({ ...o }));
  const input: Omit<PreviewInput, "decisions"> = {
    stages,
    facts: b.facts,
    starterId: b.starter_user_id ?? null,
    at,
    world,
    factLabels: new Map((ev?.facts ?? []).map((f) => [f.key, f.label])),
    outcomes,
  };
  return { input, event };
}
