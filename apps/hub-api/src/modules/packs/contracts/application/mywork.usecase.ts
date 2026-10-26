// W1 · "Việc của tôi": use case đọc + hai lệnh trên hẹn nhắc CỦA CHÍNH MÌNH (`cks_followups.user_id`). Mỗi ca MỘT tx `PackUow`
// (role `contracts_rw`, RLS tenant + luật thấy M1); số câu SQL cố định (đọc: 1; xong/nhắc lại: 1).

import type { PackUow, PackWho } from "../../kit/application/ports";
import { addDays, localDate } from "../domain/local-time.rules";
import { buildMyWork, type RawMyWork } from "../domain/mywork.rules";
import { MYWORK_AHEAD_DAYS, type MyWorkApproval, type MyWorkOut } from "../domain/mywork.types";

/** Hạn "còn cho vào danh sách": đọc HĐ đã hết hạn quá 60 ngày thì bỏ (mgmt `ARCHIVE_AFTER_DAYS`). */
export const ARCHIVE_AFTER_DAYS = 60;

export type MyWorkWindow = { today: string; horizon: string; archive: string; tz: string };
export type MyWorkRepo = {
  list(w: MyWorkWindow): Promise<RawMyWork>;
  /** Xong: hẹn nhắc của mình; `false` = không có hoặc không phải của mình (như nhau). */
  doneFollowup(id: string): Promise<boolean>;
  snoozeFollowup(id: string, localAt: string, tz: string): Promise<boolean>;
};
export type MyWorkRepos = { mywork: MyWorkRepo };

export class MyWorkFail extends Error {
  constructor(readonly kind: "not_found") {
    super(kind);
  }
}

type Deps = {
  uow: PackUow<MyWorkRepos>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now: () => Date;
  /** contract-flow S3b · việc duyệt HĐ trên engine (cờ bật); vắng ⇒ không có trường `approvals`. */
  approvals?: (who: PackWho) => Promise<MyWorkApproval[]>;
};

export function myWorkWindow(now: Date, tz: string): MyWorkWindow {
  const today = localDate(now, tz);
  return {
    today,
    horizon: addDays(today, MYWORK_AHEAD_DAYS),
    archive: addDays(today, -ARCHIVE_AFTER_DAYS),
    tz,
  };
}

export function myWork(d: Deps) {
  const list = async (who: PackWho): Promise<MyWorkOut> => {
    const w = myWorkWindow(d.now(), await d.timeZoneOf(who.tenantId));
    const raw = await d.uow.tenant(who, ({ mywork: r }) => r.list(w));
    const out = buildMyWork(raw, w.today);
    return d.approvals ? { ...out, approvals: await d.approvals(who) } : out;
  };
  const done = async (who: PackWho, id: string): Promise<{ ok: true }> => {
    if (!(await d.uow.tenant(who, ({ mywork: r }) => r.doneFollowup(id))))
      throw new MyWorkFail("not_found");
    return { ok: true };
  };
  const snooze = async (who: PackWho, id: string, localAt: string): Promise<{ ok: true }> => {
    const tz = await d.timeZoneOf(who.tenantId);
    if (!(await d.uow.tenant(who, ({ mywork: r }) => r.snoozeFollowup(id, localAt, tz))))
      throw new MyWorkFail("not_found");
    return { ok: true };
  };
  return { list, done, snooze };
}
export type MyWork = ReturnType<typeof myWork>;
