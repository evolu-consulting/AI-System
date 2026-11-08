// CR-122 · A2 · FLOW2-FR-12/15 · cổng giữa engine flow và app Community: `FactsReader` (node Nếu đọc dữ kiện HIỆN TẠI) + `OutcomeHandler`
// (node Kết thúc: Hiện/Ẩn bài, Nhận/Từ chối đơn, Ẩn/Giữ/Cảnh báo báo cáo). Đăng ký lúc mount qua `FlowOpts.registerPorts`.
import type { Tx } from "@ai/db";
import {
  type FactsReader,
  type OutcomeHandler,
  type OutcomeResult,
  type PackSystemUow,
  withPackRoleInTx,
} from "../../kit/public";
import {
  COMMUNITY_EVENTS,
  EV_JOIN,
  EV_POST,
  EV_REPORT,
  joinTarget,
  postTarget,
  reportTarget,
} from "../domain/flow-events.rules";
import {
  applyJoinOutcome,
  applyPostOutcome,
  applyReportOutcome,
  factsOf,
  markPostNotLaunched,
  openReviewForFlow,
} from "./flow-events.repo";

export const COMMUNITY_PACK = "community";

/** Một reader mỗi sự kiện (engine tra theo `(pack, event)`; `read` không có tên sự kiện). Mỗi lần đọc MỘT câu, tx gói riêng. */
export function communityFactsReaders(sys: PackSystemUow<{ tx: Tx }>): FactsReader[] {
  return COMMUNITY_EVENTS.map((event) => ({
    packKey: COMMUNITY_PACK,
    events: [event],
    read: (tenantId, ref) => sys.system(tenantId, ({ tx }) => factsOf(tx, tenantId, event, ref)),
  }));
}

/**
 * Chạy TRONG tx settle của engine (rollback cùng lượt). Idempotent theo `(runId, outcome)`: so-sánh-và-đặt theo trạng thái chờ ⇒
 * settle chạy lại hoặc hai lần Kết thúc cùng kết quả ⇒ `already_applied`, không ghi đè quyết định đã có.
 * Outcome lạ ⇒ ném (settle rollback, engine báo "Cần xử lý") — không âm thầm bỏ qua.
 */
export function communityOutcomeHandler(): OutcomeHandler<Tx> {
  return {
    packKey: COMMUNITY_PACK,
    events: COMMUNITY_EVENTS,
    async apply(tx, i) {
      const h = BY_EVENT[i.event];
      const t = h?.target(i.outcome);
      if (!h || !t) throw new Error(`Community: outcome lạ ${i.event}/${i.outcome}`);
      return withPackRoleInTx(tx, COMMUNITY_PACK, i.tenantId, () =>
        h.apply(tx, i.tenantId, i.ref, t as never),
      );
    },
    // CR-122 · P13 · lượt flow mở cho `post.created` ⇒ bài sang "chờ người duyệt" CÙNG tx tạo run (CAS, idempotent).
    launched: (tx, i) =>
      i.event === EV_POST
        ? withPackRoleInTx(tx, COMMUNITY_PACK, i.tenantId, () =>
            openReviewForFlow(tx, i.tenantId, i.ref),
          )
        : Promise.resolve(true), // P11c · false = superseded (huỷ tạo run) ⇒ sự kiện khác không gắn gì: true
    // CR-125 · UX-S5 · không mở được lượt ⇒ bài không kẹt "đang kiểm tra": chuyển người duyệt (lý do hiện ở UI từ `screen = error`).
    notLaunched: (tx, i) =>
      i.event === EV_POST
        ? withPackRoleInTx(tx, COMMUNITY_PACK, i.tenantId, () =>
            markPostNotLaunched(tx, i.tenantId, i.ref),
          )
        : Promise.resolve(false),
  };
}

type Step = {
  target: (outcome: string) => string | null;
  apply: (tx: Tx, tenantId: string, ref: string, target: never) => Promise<OutcomeResult>;
};
const BY_EVENT: Record<string, Step | undefined> = {
  [EV_POST]: { target: postTarget, apply: applyPostOutcome },
  [EV_JOIN]: { target: joinTarget, apply: applyJoinOutcome },
  [EV_REPORT]: { target: reportTarget, apply: applyReportOutcome },
};
