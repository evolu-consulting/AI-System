// CR-124 · q5 · FLOW4-FR-12 · spec §8 · bộ gửi email cho bên nhận chưa dùng nền tảng. Một lượt (`partnerEmailOnce`), số câu SQL CỐ ĐỊNH mỗi lô:
//  (1) tx system: thuê lô dòng kênh email (SKIP LOCKED) + ghi BĂM token (token sinh ở đây, 256-bit, bản rõ chỉ nằm trong thư);
//  (2) PDF của từng HĐ lấy qua cổng gói (băm SHA-256 ghi vào dòng — "bản chụp lúc gửi"); thiếu PDF ⇒ không gửi thư với link chết;
//  (3) MỘT lời gọi `sendBatch` của transport email chung của thông báo (cùng SMTP/hộp thư nền tảng);
//  (4) tx system: chốt kết cục cả lô (+ nhật ký). Mạng (PDF, SMTP) ở NGOÀI tx. Lỗi tạm ⇒ nghỉ bậc thang rồi thử lại; lỗi vĩnh viễn ⇒ dừng.
// Bật cùng `HUB_PARTNER_MAILBOX=on` (mặc định tắt). Vòng nền chỉ ngủ khi hết việc (Luật 4c); test gọi `partnerEmailOnce`.
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { PartnerMailboxPort } from "../packs/kit/public";
import { claimEmails, type EmailSettle, setTokenHashes, settleEmails } from "./adapters/email.repo";
import {
  buildPartnerEmail,
  EMAIL_BATCH,
  EMAIL_LEASE_S,
  hashHex,
  linkOf,
  newToken,
  sha256Hex,
} from "./domain/email-link.rules";
import { partnerNoticeOnce } from "./notice-dispatch";

const SYS = { kind: "system" as const };
const IDLE_MS = 2000;

export type MailOut = ReturnType<typeof buildPartnerEmail>;
export type MailResult =
  | { ok: true }
  | { ok: false; permanent: boolean; code: string; skip?: boolean };
/** Transport email chung của thông báo (cấu trúc tương thích; không import chéo module notify — ADR-0037). */
export type PartnerMailer = { sendBatch(msgs: readonly MailOut[]): Promise<MailResult[]> };

export type PartnerEmailDeps = {
  db: Db;
  /** Transport email chung (null khi thông báo tắt ⇒ không gửi, dòng nằm chờ). */
  email: () => PartnerMailer | null;
  /** Gốc URL công khai dựng link (vd `https://app.example.vn`). */
  baseUrl: string;
  /** Cổng gói lấy PDF của HĐ gửi (đọc mỗi lượt vì gói đăng ký lúc mount). */
  port: () => PartnerMailboxPort | undefined;
  batch?: number;
};
export type PartnerEmailStats = { claimed: number; sent: number; failed: number };

type Prepared = { msg: MailOut; id: string; sha: string };

async function prepare(
  d: PartnerEmailDeps,
  rows: Awaited<ReturnType<typeof claimEmails>>,
  tokens: ReadonlyMap<string, string>,
  settle: EmailSettle[],
): Promise<Prepared[]> {
  const out: Prepared[] = [];
  await Promise.all(
    rows.map(async (r) => {
      const fail = (err: string) =>
        settle.push({ id: r.id, ok: false, permanent: false, err, sha: null });
      const token = tokens.get(r.id);
      if (!token) return fail("token_not_set");
      const pdf = r.file_ref
        ? await d
            .port()
            ?.pdf?.(r.from_tenant, r.file_ref)
            .catch(() => null)
        : null;
      if (!pdf) return fail("pdf_unavailable");
      const p = r.payload ?? {};
      const msg = buildPartnerEmail({
        mailboxId: r.id,
        attempts: r.attempts,
        tenantId: r.from_tenant,
        to: r.to_email,
        link: linkOf(d.baseUrl, token),
        title: typeof p.title === "string" && p.title ? p.title : "Hợp đồng",
        senderName: r.sender_name ?? "",
        senderVerified: r.sender_verified,
        round: r.round,
        message: typeof p.message === "string" ? p.message : null,
        prevReason: r.prev_reason,
        expiresAt: new Date(r.expires_at),
      });
      out.push({ msg, id: r.id, sha: await sha256Hex(pdf.bytes) });
    }),
  );
  return out;
}

/** MỘT lời gọi `sendBatch`; ánh xạ kết quả từng thư (lỗi mạng cả lô ⇒ mọi thư lỗi tạm). */
async function sendAll(
  transport: PartnerMailer,
  ready: readonly Prepared[],
): Promise<EmailSettle[]> {
  let results: MailResult[] | null = null;
  let thrown = "no_result";
  try {
    results = await transport.sendBatch(ready.map((x) => x.msg));
  } catch (err) {
    thrown = err instanceof Error ? err.name : "send_failed";
  }
  return ready.map((x, i): EmailSettle => {
    const r = results?.[i];
    if (r?.ok) return { id: x.id, ok: true, permanent: false, err: null, sha: x.sha };
    if (r)
      return {
        id: x.id,
        ok: false,
        permanent: r.permanent || r.skip === true,
        err: r.code,
        sha: null,
      };
    return { id: x.id, ok: false, permanent: false, err: thrown, sha: null };
  });
}

export async function partnerEmailOnce(d: PartnerEmailDeps): Promise<PartnerEmailStats> {
  const transport = d.email();
  if (!transport) return { claimed: 0, sent: 0, failed: 0 };
  const tokens = new Map<string, string>();
  const rows = await withHubScope(d.db, SYS, async (tx) => {
    const claimed = await claimEmails(tx, d.batch ?? EMAIL_BATCH, EMAIL_LEASE_S);
    const hashes: { id: string; hash: string }[] = [];
    for (const r of claimed) {
      const t = newToken();
      tokens.set(r.id, t);
      hashes.push({ id: r.id, hash: await hashHex(t) });
    }
    await setTokenHashes(tx, hashes);
    return claimed;
  });
  if (rows.length === 0) return { claimed: 0, sent: 0, failed: 0 };
  const settle: EmailSettle[] = [];
  const ready = await prepare(d, rows, tokens, settle);
  if (ready.length > 0) settle.push(...(await sendAll(transport, ready)));
  await withHubScope(d.db, SYS, (tx) => settleEmails(tx, settle));
  const sent = settle.filter((s) => s.ok).length;
  return { claimed: rows.length, sent, failed: settle.length - sent };
}

export function startPartnerEmail(
  d: PartnerEmailDeps & { log?: { warn(msg: string, f?: Record<string, unknown>): void } },
  o: { signal?: AbortSignal; idleMs?: number } = {},
): void {
  const n = d.batch ?? EMAIL_BATCH;
  const loop = async () => {
    while (!o.signal?.aborted) {
      let busy = false;
      try {
        // lô đầy ⇒ còn việc, chạy tiếp ngay; CR-126 · cùng lượt báo người nhận kênh nền tảng (thư báo vào app)
        const [mail, notice] = [await partnerEmailOnce(d), await partnerNoticeOnce(d)];
        busy = mail.claimed >= n || notice.claimed >= n;
      } catch (err) {
        d.log?.warn("partner-email-failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      if (!busy) await new Promise((r) => setTimeout(r, o.idleMs ?? IDLE_MS));
    }
  };
  void loop();
}
