// CR-190 · use case tuỳ chọn THEO NGƯỜI của hội thoại (lớp 2, không SQL): ghim / bỏ ghim, đánh dấu chưa đọc / đã đọc, cho cuộc nội bộ (`/messages/conversations/:id/**`) và cuộc đối tác
// (`/messages/partner/:id/**`). Quyền: nội bộ phải là thành viên (`facts` ⇒ 404 `MSG_NOT_FOUND`, RLS 0126 chặn thêm); đối tác phải là một đầu cuộc (`pmsg_detail` ném CC404 ⇒ 404). Mọi
// thay đổi chỉ chạm hàng CỦA NGƯỜI GỌI — người khác (kể cả cùng cuộc) không thấy. Không phát realtime (riêng từng người, client tự cập nhật theo phản hồi).
import type { ConvPrefs } from "@ai/contracts/pack-contracts";
import type { PackUow, PackWho } from "../../../kit/public";
import { MsgFail } from "./messages.ops";
import type {
  MessagesRepos,
  PrefCol,
  PrefKind,
  PrefState,
  RawConversation,
} from "./messages.ports";

/** Gắn ghim + cờ của người gọi vào các dòng — MỘT câu `prefsOf` cho cả trang (không theo dòng). Cuộc không có hàng ⇒ không ghim, không cờ. */
export async function withPrefs<T extends RawConversation>(
  r: MessagesRepos,
  me: string,
  rows: readonly T[],
): Promise<T[]> {
  const m = await r.messages.prefsOf(
    me,
    rows.map((x) => x.id),
  );
  return rows.map((x) => {
    const p = m.get(x.id);
    return p ? { ...x, pinned_at: p.pinned_at, marked_unread: p.marked_unread } : x;
  });
}

/** Cùng dạng ISO (ms) như `summaryOf` ⇒ phản hồi PUT và danh sách khớp nhau. */
const outOf = (p: PrefState): ConvPrefs => ({
  pinned_at: p.pinned_at ? new Date(p.pinned_at).toISOString() : null,
  marked_unread: p.marked_unread,
});

export function prefsOps(d: { uow: PackUow<MessagesRepos> }) {
  /** Đổi một cột. Nội bộ: phải là thành viên; đối tác: phải là một đầu cuộc (DB ném CC404 ⇒ route 404). */
  const change = (kind: PrefKind, col: PrefCol) => (who: PackWho, id: string, on: boolean) =>
    d.uow.tenant(who, async (r): Promise<ConvPrefs> => {
      if (kind === "internal") {
        if (!(await r.messages.facts(who.userId, id, false))) throw new MsgFail("MSG_NOT_FOUND");
      } else if (!(await r.partner.detail(id))) throw new MsgFail("MSG_NOT_FOUND");
      return outOf(await r.messages.setPref(who.userId, { kind, id }, col, on));
    });
  return {
    /** `PUT /messages/conversations/:id/pin` */
    pin: change("internal", "pinned_at"),
    /** `PUT /messages/conversations/:id/mark-unread` (`on=false` ⇒ bỏ cờ). */
    markUnread: change("internal", "marked_unread_at"),
    /** `PUT /messages/partner/:id/pin` */
    partnerPin: change("partner", "pinned_at"),
    /** `PUT /messages/partner/:id/mark-unread` */
    partnerMarkUnread: change("partner", "marked_unread_at"),
  };
}
