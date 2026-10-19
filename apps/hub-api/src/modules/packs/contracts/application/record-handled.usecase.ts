// HD4-FR-06 · HD4-AC06 · plan §3: ghi kết quả xử lý (mgmt-app `routes/contracts.py:452-461`). MỘT tx `PackUow` (role `contracts_rw`):
// ① set_config ② khoá hàng (0 hàng ⇒ not_found = 404) ③ trạng thái theo ngày ở múi tenant (domain) ④ CTE update + event `handled`
// ⑤ outbox. Trigger HD4 xếp lịch lại (`remind_at = -infinity`) vì `handled` đổi ⇒ vòng nhắc dừng nhắc HĐ này.
import type { KitTxRepos } from "../../kit/application/index-outbox";
import type { PackUow, PackWho } from "../../kit/application/ports";
import { CONFIRMED_STATUSES, statusOn } from "../domain/deadline.rules";
import { localDate } from "../domain/local-time.rules";
import type { ContractStatus, HandledOutcome } from "../domain/status.rules";

export type HandledLocked = {
  status: ContractStatus;
  kind: string;
  endDate: string | null;
  deadline: string | null;
};
export type HandledRecord = { outcome: HandledOutcome; by: string; at: string };
export type HandledRepo = {
  lock(id: string): Promise<HandledLocked | null>;
  save(
    id: string,
    s: { status: ContractStatus; handled: HandledRecord; prev: ContractStatus },
  ): Promise<{
    version: number;
    action_deadline: string | null;
  }>;
};
export type RecordHandledResult =
  | {
      kind: "ok";
      out: {
        id: string;
        status: ContractStatus;
        handled: HandledRecord;
        action_deadline: string | null;
        version: number;
      };
    }
  | { kind: "not_found" }
  | { kind: "not_confirmed" };
export type RecordHandled = (
  who: PackWho,
  id: string,
  outcome: HandledOutcome,
) => Promise<RecordHandledResult>;

export function recordHandled(d: {
  uow: PackUow<KitTxRepos & { handled: HandledRepo }>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now: () => Date;
}): RecordHandled {
  return async (who, id, outcome) => {
    const tz = await d.timeZoneOf(who.tenantId);
    return d.uow.tenant(who, async (r): Promise<RecordHandledResult> => {
      const cur = await r.handled.lock(id);
      if (!cur) return { kind: "not_found" };
      if (cur.kind !== "contract" || !CONFIRMED_STATUSES.includes(cur.status))
        return { kind: "not_confirmed" };
      const now = d.now();
      const status = statusOn({ ...cur, outcome }, localDate(now, tz));
      const handled: HandledRecord = { outcome, by: who.userId, at: now.toISOString() };
      const saved = await r.handled.save(id, { status, handled, prev: cur.status });
      await r.outbox.enqueue([{ entity: "contract", entity_id: id, op: "upsert" }]);
      return { kind: "ok", out: { id, status, handled, ...saved } };
    });
  };
}
