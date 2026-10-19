// W1 · hẹn nhắc chung: đặt (`POST /followups`), liệt kê của mình (`GET /followups`); xong / nhắc lại sau dùng `my-work` (cùng hai bảng).
// Mỗi ca MỘT tx `PackUow` (role `contracts_rw`, RLS tenant + luật thấy M1). Hẹn nhắc là của riêng người tạo ⇒ người xem cũng đặt được.
import type { Followup, FollowupCreate } from "@ai/contracts";
import type { PackUow, PackWho } from "../../kit/application/ports";

export type FollowupsRepo = {
  /** id hẹn nhắc (mới hoặc dời); `null` = chủ thể không có hoặc người dùng không thấy. */
  create(b: FollowupCreate, tz: string): Promise<string | null>;
  mine(subjectId: string | null, tz: string): Promise<Followup[]>;
};
export type FollowupsRepos = { followups: FollowupsRepo };

export class FollowupFail extends Error {
  constructor(readonly kind: "not_found") {
    super(kind);
  }
}

type Deps = { uow: PackUow<FollowupsRepos>; timeZoneOf: (tenantId: string) => Promise<string> };

export function followupsUsecases(d: Deps) {
  const create = async (who: PackWho, b: FollowupCreate): Promise<{ id: string }> => {
    const tz = await d.timeZoneOf(who.tenantId);
    const id = await d.uow.tenant(who, ({ followups: r }) => r.create(b, tz));
    if (!id) throw new FollowupFail("not_found");
    return { id };
  };
  const mine = async (who: PackWho, subjectId: string | null): Promise<Followup[]> => {
    const tz = await d.timeZoneOf(who.tenantId);
    return d.uow.tenant(who, ({ followups: r }) => r.mine(subjectId, tz));
  };
  return { create, mine };
}
export type FollowupsUsecases = ReturnType<typeof followupsUsecases>;
