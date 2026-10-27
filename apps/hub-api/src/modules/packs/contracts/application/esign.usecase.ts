// cf-esign-docusign · use case ký số HĐ, trung lập nhà cung cấp: gửi ký (HĐ đã duyệt xong/khoá + PDF), xem trạng thái, "Ký ngay"
// (embedded), làm mới (một lần, không poll nền), huỷ, webhook (nhà cung cấp tự xác thực; map envelope ⇒ tenant qua bảng), lưu "Bản
// đã ký" vào FileBox idempotent theo envelope. Gọi mạng (nhà cung cấp, FileBox) NGOÀI tx. Thiếu cấu hình ⇒ tắt (409, không 500).
import type {
  ESignEnvelopeOut,
  ESignErrorCode,
  ESignSettingsOut,
  ESignSignerIn,
  ESignStateOut,
  ESignStatus,
} from "@ai/contracts";
import type { PackSystemUow, PackUow, PackWho } from "../../kit/application/ports";
import { defaultSigners, isOpen, mapEnvelopeStatus } from "../domain/esign.rules";
import type {
  ContractForSign,
  EnvelopeRow,
  ESignEnvelopeInfo,
  ESignFiles,
  ESignProvider,
  ESignRepo,
  StoredSigner,
} from "./esign.ports";

export class ESignFail extends Error {
  constructor(
    readonly code: ESignErrorCode | "NOT_FOUND" | "VALIDATION",
    readonly detail: string,
  ) {
    super(detail);
    this.name = "ESignFail";
  }
}

type R = { esign: ESignRepo };
export type ESignDeps = {
  /** null ⇒ chưa cấu hình (`ESIGN_PROVIDER=none` hoặc thiếu biến) ⇒ tính năng tắt. */
  provider: ESignProvider | null;
  uow: PackUow<R> & PackSystemUow<R>;
  files: ESignFiles | null;
  me: (who: PackWho) => Promise<{ name: string; email: string | null }>;
  tenantOf: (provider: string, envelopeId: string) => Promise<string | null>;
  newId: () => string;
  now?: () => Date;
};
type Run = <T>(fn: (r: R) => Promise<T>) => Promise<T>;

const envelopeOut = (e: EnvelopeRow, demo: boolean): ESignEnvelopeOut => ({
  id: e.id,
  provider: e.provider,
  demo,
  status: e.status,
  signers: e.signers.map((s) => ({
    role: s.role,
    name: s.name,
    email: s.email,
    order: s.order,
    embedded: s.client_user_id !== null,
    status: s.status,
    signed_at: s.signed_at,
  })),
  reason: e.reason,
  completed_at: e.completedAt,
  created_at: e.createdAt,
  has_signed_file: e.signedFileId !== null,
});

/** Trạng thái người ký theo email từ nhà cung cấp; ký xong cả envelope mà không có chi tiết ⇒ coi mọi người đã ký. */
function mergeSigners(s: StoredSigner[], info: ESignEnvelopeInfo, st: ESignStatus): StoredSigner[] {
  return s.map((x) => {
    const r = info.recipients.find((y) => y.email.toLowerCase() === x.email);
    if (r) return { ...x, status: r.status, signed_at: r.signedAt };
    return st === "completed" ? { ...x, status: "completed", signed_at: info.completedAt } : x;
  });
}

/** Gửi ký được: HĐ thấy được + đã duyệt xong (khoá) + chưa có envelope đang chờ + tệp PDF ⇒ tệp. */
function sendableFile(c: ContractForSign | null, e: EnvelopeRow | null) {
  if (!c) throw new ESignFail("NOT_FOUND", "contract");
  if (!c.locked) throw new ESignFail("ESIGN_STATE", "not-approved");
  if (e && isOpen(e.status)) throw new ESignFail("ESIGN_STATE", "already-open");
  if (!c.file || c.file.mime !== "application/pdf")
    throw new ESignFail("ESIGN_UNSUPPORTED_FILE", c.file ? "not-pdf" : "no-file");
  return c.file;
}

/** Thứ tự ký = thứ tự gửi; đại diện công ty trùng email user hiện tại ⇒ ký nhúng (clientUserId = user). */
function storedSigners(
  signers: ESignSignerIn[],
  userId: string,
  email: string | null,
): StoredSigner[] {
  const mine = email?.toLowerCase() ?? null;
  return signers.map((x, i) => ({
    ...x,
    order: i + 1,
    client_user_id: x.role === "company" && mine !== null && x.email === mine ? userId : null,
    status: null,
    signed_at: null,
  }));
}

const baseName = (n: string) => n.replace(/\.pdf$/i, "").slice(0, 150);
const RETURN_PATH = (id: string) => new RegExp(`/contracts/${id}/?$`);

export function esignUsecase(d: ESignDeps) {
  const on = (): ESignProvider | null => (d.provider && d.files ? d.provider : null);
  const tenantRun =
    (who: PackWho): Run =>
    (fn) =>
      d.uow.tenant(who, fn);
  const demoOf = (key: string) => key === "selfsign";

  const settings = async (who: PackWho): Promise<ESignSettingsOut> => {
    const enabled = await d.uow.tenant(who, (r) => r.esign.enabled());
    const p = on();
    return { configured: p !== null, enabled, provider: p?.key ?? null, demo: p?.demo ?? false };
  };

  /** Lưu "Bản đã ký" (nhà cung cấp ⇒ PDF đã ký; ký thử ⇒ PDF gốc) — mất đua ⇒ xoá tệp vừa đẩy. */
  const storeSigned = async (
    p: ESignProvider,
    files: ESignFiles,
    tid: string,
    row: EnvelopeRow,
    run: Run,
  ) => {
    const c = await run((r) => r.esign.contract(row.contractId));
    if (!c?.file) return;
    const org = `t_${tid}`;
    const bytes =
      (await p.combinedPdf(row.envelopeId)) ?? (await files(c.file.org).getContent(c.file.fileId));
    if (!bytes) throw new ESignFail("ESIGN_PROVIDER", "signed-pdf-missing");
    const name = `${baseName(c.file.name)}-${p.demo ? "ky-thu" : "da-ky"}.pdf`;
    const up = await files(org).postFile(name, bytes);
    const f = {
      id: d.newId(),
      org,
      ...up,
      name,
      sizeBytes: bytes.byteLength,
      createdBy: row.sentBy,
    };
    const ok = await run((r) => r.esign.attachSigned(row.envelopeId, f)).catch(async (e) => {
      await files(org)
        .deleteFile(up.fileId)
        .catch(() => null);
      throw e;
    });
    if (!ok)
      await files(org)
        .deleteFile(up.fileId)
        .catch(() => null);
  };

  /** Một lần GET trạng thái từ nhà cung cấp ⇒ cập nhật hàng; ký xong ⇒ lưu bản đã ký (idempotent). */
  /** `given` (ký thử): trạng thái đã biết, không hỏi nhà cung cấp. */
  const sync = async (
    tid: string,
    row: EnvelopeRow,
    run: Run,
    given?: ESignEnvelopeInfo,
  ): Promise<void> => {
    const p = on();
    if (!p || !d.files || p.key !== row.provider) return;
    if (!isOpen(row.status) && !(row.status === "completed" && row.signedFileId === null)) return;
    const info = given ?? (await p.getEnvelope(row.envelopeId));
    const st = mapEnvelopeStatus(info.status) ?? row.status;
    const signers = mergeSigners(row.signers, info, st);
    await run((r) =>
      r.esign.update(row.envelopeId, {
        status: st,
        reason: st === "declined" || st === "voided" ? info.reason : null,
        completedAt: st === "completed" ? (info.completedAt ?? new Date().toISOString()) : null,
        signers,
      }),
    );
    if (st === "completed" && row.signedFileId === null)
      await storeSigned(p, d.files, tid, row, run);
  };

  const state = async (who: PackWho, id: string): Promise<ESignStateOut> => {
    const s = await settings(who);
    const got = await d.uow.tenant(who, async (r) => ({
      c: await r.esign.contract(id),
      e: await r.esign.latest(id),
    }));
    if (!got.c) throw new ESignFail("NOT_FOUND", "contract");
    const me = await d.me(who);
    return {
      ...s,
      ready: got.c.locked && got.c.file?.mime === "application/pdf",
      envelope: got.e ? envelopeOut(got.e, demoOf(got.e.provider)) : null,
      defaults: defaultSigners({ me, partner: got.c.partner }),
    };
  };

  const openOf = async (who: PackWho, id: string) => {
    const e = await d.uow.tenant(who, async (r) => {
      if (!(await r.esign.contract(id))) throw new ESignFail("NOT_FOUND", "contract");
      return r.esign.latest(id);
    });
    if (!e || !isOpen(e.status)) throw new ESignFail("ESIGN_STATE", "no-open-envelope");
    return e;
  };

  return {
    settings,
    state,
    saveSettings: async (who: PackWho, enabled: boolean): Promise<ESignSettingsOut> => {
      await d.uow.tenant(who, (r) => r.esign.saveEnabled(enabled, who.userId));
      return settings(who);
    },

    async send(who: PackWho, id: string, signers: ESignSignerIn[]): Promise<ESignStateOut> {
      const p = on();
      const s = await settings(who);
      if (!p || !d.files || !s.enabled) throw new ESignFail("ESIGN_DISABLED", "disabled");
      const got = await d.uow.tenant(who, async (r) => ({
        c: await r.esign.contract(id),
        e: await r.esign.latest(id),
      }));
      const file = sendableFile(got.c, got.e);
      const bytes = await d.files(file.org).getContent(file.fileId);
      if (!bytes) throw new ESignFail("ESIGN_PROVIDER", "file-unavailable");
      const stored = storedSigners(signers, who.userId, (await d.me(who)).email);
      const { envelopeId } = await p.createEnvelope({
        subject: `Ky hop dong: ${got.c?.title ?? ""}`.slice(0, 100),
        document: { name: file.name, bytes },
        signers: stored.map((x) => ({
          name: x.name,
          email: x.email,
          order: x.order,
          clientUserId: x.client_user_id,
        })),
      });
      const ok = await d.uow.tenant(who, (r) =>
        r.esign.insert({
          contractId: id,
          provider: p.key,
          envelopeId,
          signers: stored,
          sentBy: who.userId,
        }),
      );
      if (!ok) {
        await p.voidEnvelope(envelopeId, "duplicate").catch(() => null);
        throw new ESignFail("ESIGN_STATE", "already-open");
      }
      return state(who, id);
    },

    async refresh(who: PackWho, id: string): Promise<ESignStateOut> {
      const e = await d.uow.tenant(who, async (r) => {
        if (!(await r.esign.contract(id))) throw new ESignFail("NOT_FOUND", "contract");
        return r.esign.latest(id);
      });
      if (e) await sync(who.tenantId, e, tenantRun(who));
      return state(who, id);
    },

    async signUrl(who: PackWho, id: string, returnUrl: string): Promise<{ url: string }> {
      const u = new URL(returnUrl);
      if (!/^https?:$/.test(u.protocol) || !RETURN_PATH(id).test(u.pathname))
        throw new ESignFail("VALIDATION", "return_url");
      const p = on();
      if (!p) throw new ESignFail("ESIGN_DISABLED", "disabled");
      const e = await openOf(who, id);
      const me = e.signers.find((s) => s.client_user_id === who.userId);
      if (!me || e.provider !== p.key) throw new ESignFail("ESIGN_STATE", "not-embedded-signer");
      u.searchParams.set("esign", "return");
      const url = await p.recipientView(
        e.envelopeId,
        { name: me.name, email: me.email, clientUserId: who.userId },
        u.toString(),
      );
      // esign-fix · ký thử: CHỈ người ký nhúng bấm "Ký ngay" mới hoàn tất (làm mới chỉ đọc trạng thái "đang chờ").
      if (p.demo) {
        const done = {
          status: "completed",
          reason: null,
          completedAt: (d.now?.() ?? new Date()).toISOString(),
        };
        await sync(who.tenantId, e, tenantRun(who), { ...done, recipients: [] });
      }
      return { url };
    },

    async voidIt(who: PackWho, id: string, reason: string): Promise<ESignStateOut> {
      const p = on();
      if (!p) throw new ESignFail("ESIGN_DISABLED", "disabled");
      const e = await openOf(who, id);
      if (e.provider !== p.key) throw new ESignFail("ESIGN_STATE", "provider-changed");
      await p.voidEnvelope(e.envelopeId, reason);
      await d.uow.tenant(who, (r) =>
        r.esign.update(e.envelopeId, {
          status: "voided",
          reason,
          completedAt: null,
          signers: e.signers,
        }),
      );
      return state(who, id);
    },

    async signedLink(who: PackWho, id: string): Promise<string | null> {
      if (!d.files) return null;
      const f = await d.uow.tenant(who, (r) => r.esign.signedFile(id));
      return f ? d.files(f.org).getLink(f.fileId) : null;
    },

    /** Webhook: nhà cung cấp tự xác thực (HMAC…); chỉ tin envelopeId ⇒ tenant qua bảng ⇒ GET trạng thái thật. */
    async webhook(
      key: string,
      raw: Uint8Array,
      header: (n: string) => string | undefined,
    ): Promise<"ok" | "ignored"> {
      const p = on();
      if (!p || p.key !== key || !p.webhook) throw new ESignFail("NOT_FOUND", "provider");
      const chk = p.webhook(raw, header);
      if (!chk.ok) throw new ESignFail("ESIGN_WEBHOOK_REJECTED", "signature");
      if (!chk.envelopeId) return "ignored";
      const tid = await d.tenantOf(p.key, chk.envelopeId);
      if (!tid) return "ignored";
      const run: Run = (fn) => d.uow.system(tid, fn);
      const row = await run((r) => r.esign.byEnvelope(chk.envelopeId as string));
      if (!row) return "ignored";
      await sync(tid, row, run);
      return "ok";
    },
  };
}
export type ESignUsecase = ReturnType<typeof esignUsecase>;
