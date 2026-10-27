// V2-K · TQ-01/TQ-02: Tổng quan (4 con số + theo nhóm) và Cần xử lý 8 nguồn (đọc, Bỏ qua / Đã xong). Mỗi ca MỘT tx `PackUow` (role
// `contracts_rw`, RLS tenant + luật thấy M1); số câu SQL cố định (Tổng quan: 1; Cần xử lý: 1; Bỏ qua/Đã xong: 1). Ngày = lịch tenant.
import type { PackUow, PackWho } from "../../kit/application/ports";
import { addDays, localDate } from "../domain/local-time.rules";
import { MYWORK_AHEAD_DAYS } from "../domain/mywork.types";
import {
  buildOverview,
  type OverviewOut,
  type OverviewPeriod,
  overviewRange,
} from "../domain/overview.rules";
import type { RepEngine } from "../domain/rep-current.rules";
import {
  buildTodo,
  parseTodoKey,
  quarterWindow,
  type TodoAction,
  type TodoOut,
} from "../domain/todo.rules";
import type { MyWorkRepo } from "./mywork.usecase";
import type { OverviewRepo, TodoRepo } from "./overview.ports";

export type OverviewRepos = { overview: OverviewRepo; todo: TodoRepo; mywork: MyWorkRepo };

export class TodoFail extends Error {
  constructor(readonly kind: "invalid" | "not_found") {
    super(kind);
  }
}

type Deps = {
  uow: PackUow<OverviewRepos>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now: () => Date;
  /** REP-v3 mục 7: `v2e` ⇒ bật nguồn "Đánh giá đối tác"; vắng ⇒ `hd8` (tắt). */
  engine?: () => RepEngine;
};

export function overviewUsecase(d: Deps) {
  const zone = async (who: PackWho) => {
    const tz = await d.timeZoneOf(who.tenantId);
    return { tz, today: localDate(d.now(), tz) };
  };
  const overview = async (who: PackWho, period: OverviewPeriod): Promise<OverviewOut> => {
    const { today } = await zone(who);
    const r = overviewRange(today, period);
    const raw = await d.uow.tenant(who, ({ overview: o }) =>
      o.months({ from: r.window_from, to: r.to, profitFrom: r.prev_from }),
    );
    return buildOverview(raw.months, Number(raw.stock), today, period);
  };
  const todo = async (who: PackWho): Promise<TodoOut> => {
    const { today, tz } = await zone(who);
    const raw = await d.uow.tenant(who, ({ todo: t }) =>
      t.list({
        today,
        horizon: addDays(today, MYWORK_AHEAD_DAYS),
        tz,
        quarter: quarterWindow(today),
        rating: d.engine?.() === "v2e",
      }),
    );
    return buildTodo(raw ?? [], today);
  };
  /** Liên hệ mời gia hạn = hẹn nhắc (W1/V2-H) của mình ⇒ đóng hẹn nhắc; việc suy ra khác ⇒ ghi khoá của mình. */
  const dismiss = async (who: PackWho, key: string, action: TodoAction): Promise<{ ok: true }> => {
    const k = parseTodoKey(key);
    if (!k) throw new TodoFail("invalid");
    await d.uow.tenant(who, async (r) => {
      if (k.raw === "renewal_contact") {
        if (!(await r.mywork.doneFollowup(k.id))) throw new TodoFail("not_found");
        return;
      }
      await r.todo.dismiss(key, action);
    });
    return { ok: true };
  };
  return { overview, todo, dismiss };
}
export type OverviewUsecase = ReturnType<typeof overviewUsecase>;
