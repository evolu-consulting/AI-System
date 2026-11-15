// CR-169 · lát 3a · use case Tin nhắn với người công ty đã kết nối (lớp 2, không SQL): mở cuộc `partner`, danh bạ, công ty. Quyền = hàm DEFINER `pmsg_*` (P1: có quyền Sổ Hợp
// Tác, không external; P2/P4: kết nối + người kia hợp lệ; công ty thứ ba ⇒ không thấy). Lỗi DB đi thẳng lên route (`partner.errors.ts` ánh xạ SQLSTATE `CC*`/42501).
import type {
  ConversationDetail,
  CreateConversationRequest,
  MsgCompanyPage,
  MsgPeoplePage,
} from "@ai/contracts/pack-contracts";
import type { PackUow, PackWho } from "../../../kit/public";
import { conversationFrames, type MsgFrame } from "../domain/messages.events";
import type { CompanyFilter } from "../domain/partner.rules";
import type { MessagesRepos, PeopleLookup } from "./messages.ports";
import { partnerDetailOf } from "./messages.view";

export type DirectoryFn = (
  who: { tenantId: string; userId: string; userKind?: "internal" | "external" },
  opt: { cursor?: string | undefined; limit: number; q?: string | undefined },
) => Promise<MsgPeoplePage>;

export type PartnerDeps = {
  uow: PackUow<MessagesRepos>;
  people: PeopleLookup;
  /** Nguồn `own`: đồng nghiệp của chính công ty (theo phòng ban rồi tên — CR-148). */
  directory: DirectoryFn;
  emit: (frames: MsgFrame[]) => Promise<void>;
};

/** Con trỏ keyset của `pmsg_people`/`pmsg_companies` = base64url JSON `[sort_key, id]` (hai cột trả về của dòng cuối). Hỏng ⇒ `null`. */
export const encodeKeyCursor = (key: string, id: string): string =>
  Buffer.from(JSON.stringify([key, id])).toString("base64url");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function decodeKeyCursor(s: string): { key: string; id: string } | null {
  try {
    const v: unknown = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    if (!Array.isArray(v) || v.length !== 2) return null;
    const [key, id] = v;
    return typeof key === "string" && typeof id === "string" && UUID_RE.test(id)
      ? { key, id }
      : null;
  } catch {
    return null;
  }
}
const badCursor = () => new Error("BAD_CURSOR");

export function partnerOps(d: PartnerDeps) {
  return {
    /** `POST /messages/conversations` `kind: partner`: mở (hoặc lấy lại) cuộc với người của công ty đã kết nối. `created` ⇒ phát `msg.conversation added` cho CẢ HAI đầu. */
    async createPartner(
      who: PackWho,
      req: Extract<CreateConversationRequest, { kind: "partner" }>,
    ): Promise<{ detail: ConversationDetail; created: boolean }> {
      const out = await d.uow.tenant(who, async (r) => {
        const o = await r.partner.open(req.tenant_id, req.user_id);
        return { o, row: await r.partner.detail(o.id) };
      });
      if (!out.row) throw new Error("pmsg_detail: không thấy cuộc vừa mở");
      const self = (await d.people(who, [who.userId])).get(who.userId);
      const detail = partnerDetailOf(out.row, { id: who.userId, name: self?.name ?? "" });
      if (out.o.created)
        await d.emit(conversationFrames(detail.id, { added: [who.userId, req.user_id] }));
      return { detail, created: out.o.created };
    },

    /** Danh bạ «Thành viên»: `own` = đồng nghiệp (nguồn CR-148); `all`/công ty = `pmsg_people` (người có quyền Sổ Hợp Tác; công ty không kết nối ⇒ rỗng, không lộ). */
    async people(
      who: PackWho,
      q: { cursor?: string | undefined; q?: string | undefined; limit: number },
      filter: CompanyFilter,
    ): Promise<MsgPeoplePage> {
      if (filter.kind === "own") return d.directory(who, q);
      const cur = q.cursor ? decodeKeyCursor(q.cursor) : null;
      if (q.cursor && !cur) throw badCursor();
      const rows = await d.uow.tenant(who, (r) =>
        r.partner.people({
          tenants: filter.kind === "company" ? [filter.tenantId] : null,
          q: q.q && q.q.length > 0 ? q.q : null,
          cur,
          limit: q.limit + 1,
        }),
      );
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((p) => ({
          id: p.user_id,
          name: p.name,
          department:
            p.department_id && p.department_name
              ? { id: p.department_id, name: p.department_name }
              : null,
          job_title: p.job_title,
          company: { id: p.tenant_id, name: p.company_name },
        })),
        next_cursor:
          rows.length > q.limit && last ? encodeKeyCursor(last.sort_key, last.user_id) : null,
      };
    },

    /** Công ty đang kết nối (chip lọc), theo tên, tải dần. */
    async companies(
      who: PackWho,
      q: { cursor?: string | undefined; limit: number },
    ): Promise<MsgCompanyPage> {
      const cur = q.cursor ? decodeKeyCursor(q.cursor) : null;
      if (q.cursor && !cur) throw badCursor();
      const rows = await d.uow.tenant(who, (r) => r.partner.companies(cur, q.limit + 1));
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((c) => ({ id: c.company_id, name: c.name })),
        next_cursor:
          rows.length > q.limit && last ? encodeKeyCursor(last.sort_key, last.company_id) : null,
      };
    },
  };
}
