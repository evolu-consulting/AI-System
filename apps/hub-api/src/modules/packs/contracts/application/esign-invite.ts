// CR-125 · x12 · thông báo "Mời ký số" có DỮ LIỆU THẺ (email giàu). Một nguồn: dựng `NotifyInput` cho cả đường cũ (esign-flow) lẫn bước Ký số của flow (intake.mount).
// Chỉ tên/số HĐ, đối tác, giá trị, ngày hiệu lực, người yêu cầu, hạn ký + ảnh trang 1 (nếu công ty bật) — KHÔNG PDF, KHÔNG điều khoản, KHÔNG token.
// Ảnh dựng MỘT lần mỗi phiên bản HĐ (tệp bất biến: phiên bản mới = tệp mới) và nhớ trong bộ nhớ (kể cả thất bại trong 10 phút, để không dựng lại liên tục);
// mọi lỗi dựng ảnh/đọc tệp ⇒ bỏ ảnh, vẫn có thẻ. Mạng (FileBox) và dựng ảnh nằm NGOÀI tx.
import type { NotifyInput, PackSystemUow } from "../../kit/public";
import { orgForTenant } from "../../kit/public";
import type { ESignFiles, ESignRepo } from "./esign.ports";
import { signInviteBell } from "./esign-flow.usecase";

/** CR-125 · liên kết trong thư "Mời ký": trang HĐ + ý định ký `?ky=1` (web tự mở trang ký nếu đúng lượt) + neo thẻ ký. */
export const signInviteLink = (base: string | null | undefined, id: string): string => {
  const path = (base ?? `/contracts/c/${id}`).split("#")[0] ?? "";
  return `${path}${path.includes("?") ? "&" : "?"}ky=1#esign-panel`;
};

export type InviteThumb = { b64: string; width: number; height: number };
/** Cổng dựng ảnh trang đầu (adapter `page-thumb.ts`); null ⇒ bỏ ảnh. */
export type ThumbRenderer = (pdf: Uint8Array) => Promise<InviteThumb | null>;

type Entry = { p: Promise<InviteThumb | null>; at: number; ok: boolean };
const NEG_TTL_MS = 10 * 60_000;
const CACHE_MAX = 200;

export type InviteDeps = {
  uow: PackSystemUow<{ esign: Pick<ESignRepo, "inviteCard"> }>;
  /** Tên hiển thị của người dùng (người yêu cầu). Lỗi/trống ⇒ bỏ dòng. */
  person: (tenantId: string, userId: string) => Promise<string>;
  files: ESignFiles | null;
  render: ThumbRenderer;
  now?: () => Date;
  /** Test tiêm để đếm số lần dựng; mặc định bộ nhớ riêng của instance. */
  cache?: Map<string, Entry>;
};

type InviteCard = NonNullable<Awaited<ReturnType<ESignRepo["inviteCard"]>>>;

function inviteData(
  card: InviteCard,
  o: { who: string; thumb: InviteThumb | null; nowIso: string },
) {
  return {
    type: "esign_invite",
    contract: {
      title: card.title,
      number: card.number,
      partner: card.partner,
      value: card.value,
      start: card.start,
      end: card.end,
    },
    requested_by: { name: o.who || null, company: card.company },
    requested_at: card.sentAt ?? o.nowIso,
    deadline: card.dueAt,
    ...(o.thumb ? { thumb: o.thumb } : {}),
  };
}

export function inviteNotice(d: InviteDeps) {
  const cache = d.cache ?? new Map<string, Entry>();
  const now = () => (d.now ?? (() => new Date()))().getTime();

  const thumbOf = (
    tid: string,
    f: { fileRow: string; org: string; fileId: string; mime: string | null },
  ): Promise<InviteThumb | null> => {
    const key = `${tid}:${f.fileRow}`;
    const hit = cache.get(key);
    if (hit && (hit.ok || now() - hit.at < NEG_TTL_MS)) return hit.p;
    if (!d.files || f.org !== orgForTenant(tid) || (f.mime && !/pdf/i.test(f.mime)))
      return Promise.resolve(null);
    const files = d.files;
    const p = (async () => {
      const bytes = await files(f.org).getContent(f.fileId);
      return bytes && bytes.length > 0 ? d.render(bytes) : null;
    })().catch(() => null);
    const e: Entry = { p, at: now(), ok: false };
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, e);
    void p.then((v) => {
      e.ok = v !== null;
    });
    return p;
  };

  /** Chuông + dữ liệu thẻ cho một người ký công ty. Lỗi bất kỳ ⇒ chuông thường (không chặn bước gửi ký). */
  return async (tid: string, id: string, signer: string, label: string): Promise<NotifyInput> => {
    const plain = signInviteBell(signer, id, label);
    try {
      const card = await d.uow.system(tid, (r) => r.esign.inviteCard(id));
      if (!card) return plain;
      const [thumb, who] = await Promise.all([
        card.thumbOn && card.file ? thumbOf(tid, card.file) : Promise.resolve(null),
        card.ownerId ? d.person(tid, card.ownerId).catch(() => "") : Promise.resolve(""),
      ]);
      return {
        ...plain,
        link: signInviteLink(plain.link, id),
        data: inviteData(card, { who, thumb, nowIso: new Date(now()).toISOString() }),
      };
    } catch {
      return plain;
    }
  };
}
