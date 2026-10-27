// cf-esign-docusign + esign-multi · use case ký số HĐ, trung lập nhà cung cấp, NHIỀU nhà cung cấp song song (registry): gửi ký (HĐ đã
// duyệt xong/khoá + PDF; nhà cung cấp chỉ định hoặc mặc định công ty), xem trạng thái, "Ký ngay" (embedded, chỉ người ký công ty),
// làm mới (một lần, không poll nền), huỷ, webhook (nhà cung cấp tự xác thực; map envelope ⇒ tenant qua bảng), lưu "Bản đã ký" vào
// FileBox idempotent. Mọi lệnh sau gửi dùng `provider` LƯU trên envelope (đổi mặc định không làm hỏng phong bì đang mở). Gọi mạng
// NGOÀI tx. Thiếu cấu hình ⇒ tắt (409, không 500).
import type { ESignSettingsOut, ESignSignerIn, ESignStateOut } from "@ai/contracts";
import type { PackSystemUow, PackUow, PackWho } from "../../kit/application/ports";
import { defaultSigners, type ESignStatus, isOpen, mapEnvelopeStatus } from "../domain/esign.rules";
import {
  ESignFail,
  envelopeOut,
  kindOf,
  labelOf,
  mergeSigners,
  sendableFile,
  settingsOut,
  storedSigners,
} from "./esign.helpers";
import type {
  EnvelopeRow,
  ESignEnvelopeInfo,
  ESignFiles,
  ESignProvider,
  ESignRegistry,
  ESignRepo,
} from "./esign.ports";
import type { ESignAnchors } from "./esign-anchor.usecase";

export { ESignFail } from "./esign.helpers";

type R = { esign: ESignRepo };
export type ESignDeps = {
  /** Registry nhà cung cấp (`ESIGN_PROVIDERS`); không nhà cung cấp khả dụng ⇒ tính năng tắt. */
  providers: ESignRegistry;
  uow: PackUow<R> & PackSystemUow<R>;
  files: ESignFiles | null;
  me: (who: PackWho) => Promise<{ name: string; email: string | null }>;
  tenantOf: (provider: string, envelopeId: string) => Promise<string | null>;
  newId: () => string;
  now?: () => Date;
  /** esign-anchor · chọn vị trí ô ký trong văn bản HĐ; vắng ⇒ luôn trang ký cuối. */
  anchors?: ESignAnchors;
  /** esign-flow · phong bì sang trạng thái cuối (webhook/làm mới/ký thử) ⇒ cập nhật bước Ký số của luồng duyệt. */
  onStatus?: (tenantId: string, contractId: string, status: ESignStatus) => Promise<void>;
};
type Run = <T>(fn: (r: R) => Promise<T>) => Promise<T>;

const FINAL = new Set<ESignStatus>(["completed", "declined", "voided"]);
const baseName = (n: string) => n.replace(/\.pdf$/i, "").slice(0, 150);
const RETURN_PATH = (id: string) => new RegExp(`/contracts/${id}/?$`);

export function esignUsecase(d: ESignDeps) {
  /** Adapter khả dụng của khoá (cần FileBox) hoặc null. */
  const avail = (key: string | null | undefined): ESignProvider | null =>
    key && d.files ? d.providers.get(key) : null;
  const tenantRun =
    (who: PackWho): Run =>
    (fn) =>
      d.uow.tenant(who, fn);
  const demoOf = (key: string) => d.providers.get(key)?.demo ?? key === "selfsign";
  const out = (s: { enabled: boolean; defaultProvider: string | null }) =>
    settingsOut(d.providers.entries, d.files !== null, s, demoOf);
  const settings = async (who: PackWho): Promise<ESignSettingsOut> =>
    out(await d.uow.tenant(who, (r) => r.esign.settings()));
  const rowOut = (e: EnvelopeRow) =>
    envelopeOut(e, demoOf(e.provider), labelOf(d.providers.entries, e.provider));

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
    const drop = () =>
      files(org)
        .deleteFile(up.fileId)
        .catch(() => null);
    const ok = await run((r) => r.esign.attachSigned(row.envelopeId, f)).catch(async (e) => {
      await drop();
      throw e;
    });
    if (!ok) await drop();
  };

  /** Một lần GET trạng thái từ nhà cung cấp CỦA ENVELOPE ⇒ cập nhật hàng; ký xong ⇒ lưu bản đã ký (idempotent).
   *  `given` (ký thử): trạng thái đã biết, không hỏi nhà cung cấp. */
  const sync = async (
    tid: string,
    row: EnvelopeRow,
    run: Run,
    given?: ESignEnvelopeInfo,
  ): Promise<void> => {
    const p = avail(row.provider);
    if (!p || !d.files) return;
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
    await finalHook(tid, row, st);
  };

  /** esign-flow · trạng thái cuối MỚI ⇒ bước Ký số của luồng duyệt (xong / cần quyết). Lỗi hook không làm hỏng đồng bộ phong bì. */
  const finalHook = async (tid: string, row: EnvelopeRow, st: ESignStatus) => {
    if (st === row.status || !FINAL.has(st)) return;
    await d.onStatus?.(tid, row.contractId, st).catch(() => null);
  };

  /** Gửi ký trong `run` (tenant của người bấm, hoặc hệ thống cho bước Ký số tự động); người ký công ty = `who.userId`. */
  const sendWith = async (
    run: Run,
    who: PackWho,
    id: string,
    signers: ESignSignerIn[],
    providerKey?: string,
  ): Promise<void> => {
    const s = out(await run((r) => r.esign.settings()));
    if (!d.files || !s.configured || !s.enabled) throw new ESignFail("ESIGN_DISABLED", "disabled");
    const p = avail(providerKey ?? s.default_provider);
    if (!p) throw new ESignFail("ESIGN_PROVIDER_UNAVAILABLE", "provider");
    const got = await run(async (r) => ({
      c: await r.esign.contract(id),
      e: await r.esign.latest(id),
    }));
    const file = sendableFile(got.c, got.e);
    const stored = storedSigners(signers, who.userId, await d.me(who));
    const bytes = await d.files(file.org).getContent(file.fileId);
    if (!bytes) throw new ESignFail("ESIGN_PROVIDER", "file-unavailable");
    const title = got.c?.title ?? "";
    // esign-anchor · ô ký trong văn bản HĐ (gửi tay lẫn gửi tự động của bước Ký số).
    const anchors = await anchorsFor(who, id, p, stored, bytes);
    const { envelopeId } = await p.createEnvelope({
      anchors,
      subject: `Ky hop dong: ${title}`.slice(0, 100),
      title,
      number: got.c?.number ?? null,
      document: { name: file.name, bytes },
      signers: stored.map((x) => ({
        role: x.role,
        name: x.name,
        email: x.email,
        order: x.order,
        clientUserId: x.client_user_id,
      })),
    });
    const row = { contractId: id, provider: p.key, envelopeId, signers: stored };
    const ok = await run((r) => r.esign.insert({ ...row, sentBy: who.userId }));
    if (!ok) {
      await p.voidEnvelope(envelopeId, "duplicate").catch(() => null);
      throw new ESignFail("ESIGN_STATE", "already-open");
    }
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
      envelope: got.e ? rowOut(got.e) : null,
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

  /** Nhà cung cấp người ký chọn lúc "Ký ngay": chỉ phong bì loại "ca" (khả dụng, cùng loại); loại "envelope" chỉ nhận đúng khoá. */
  const signerProvider = (e: EnvelopeRow, key: string | undefined): string | null => {
    if (key === undefined || key === e.provider) return null;
    const ok =
      kindOf(d.providers.entries, e.provider) === "ca" &&
      kindOf(d.providers.entries, key) === "ca" &&
      avail(key) !== null;
    if (!ok) throw new ESignFail("ESIGN_PROVIDER_UNAVAILABLE", "signer-provider");
    return key;
  };

  /** esign-anchor · cụm trong văn bản cho từng người ký (chỉ nhà cung cấp loại "envelope"); không đặt được ⇒ null (trang ký cuối).
   *  Lỗi đọc chữ không chặn gửi ký. */
  const anchorsFor = async (
    who: PackWho,
    id: string,
    p: ESignProvider,
    stored: { role: "company" | "partner" }[],
    bytes: Uint8Array,
  ): Promise<string[] | null> => {
    if (!d.anchors || kindOf(d.providers.entries, p.key) !== "envelope") return null;
    const pick = await d.anchors
      .pick(
        who,
        id,
        stored.map((s) => s.role),
        bytes,
      )
      .catch(() => null);
    return pick?.mode === "text" ? pick.anchors : null;
  };

  return {
    settings,
    state,
    /** esign-anchor · vị trí ô ký (route Cài đặt cụm + xem trước); vắng ⇒ không có route. */
    anchors: d.anchors ?? null,
    async saveSettings(
      who: PackWho,
      b: { enabled?: boolean | undefined; default_provider?: string | undefined },
    ): Promise<ESignSettingsOut> {
      if (b.default_provider !== undefined && !avail(b.default_provider))
        throw new ESignFail("ESIGN_PROVIDER_UNAVAILABLE", "default_provider");
      const patch = {
        ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
        ...(b.default_provider !== undefined ? { defaultProvider: b.default_provider } : {}),
      };
      await d.uow.tenant(who, (r) => r.esign.saveSettings(patch, who.userId));
      return settings(who);
    },

    async send(
      who: PackWho,
      id: string,
      signers: ESignSignerIn[],
      providerKey?: string,
    ): Promise<ESignStateOut> {
      await sendWith(tenantRun(who), who, id, signers, providerKey);
      return state(who, id);
    },

    /** esign-flow · bước Ký số của luồng duyệt: gửi ký ở scope hệ thống của tenant (người bấm không có — engine finalize), người ký
     *  công ty = `signer` theo cấu hình bước (không phải người bấm). Lỗi ⇒ ném `ESignFail`/lỗi nhà cung cấp (người gọi đổi "cần quyết"). */
    async sendSystem(
      tenantId: string,
      signer: string,
      id: string,
      signers: ESignSignerIn[],
      providerKey?: string,
    ): Promise<void> {
      const run: Run = (fn) => d.uow.system(tenantId, fn);
      await sendWith(run, { tenantId, userId: signer }, id, signers, providerKey);
    },

    /** esign-flow · K4 mở lại HĐ: phong bì đang mở ⇒ huỷ ở nhà cung cấp + ghi `voided` (bản đã ký cũ giữ lịch sử). Không ném. */
    async voidOpen(who: PackWho, id: string): Promise<boolean> {
      const e = await d.uow.tenant(who, (r) => r.esign.latest(id)).catch(() => null);
      if (!e || !isOpen(e.status)) return false;
      const p = avail(e.provider);
      if (p) await p.voidEnvelope(e.envelopeId, "contract-reopened").catch(() => null);
      const p2 = { status: "voided" as const, reason: "contract-reopened", completedAt: null };
      await d.uow.tenant(who, (r) => r.esign.update(e.envelopeId, { ...p2, signers: e.signers }));
      return true;
    },

    async refresh(who: PackWho, id: string): Promise<ESignStateOut> {
      const e = await d.uow.tenant(who, async (r) => {
        if (!(await r.esign.contract(id))) throw new ESignFail("NOT_FOUND", "contract");
        return r.esign.latest(id);
      });
      if (e) await sync(who.tenantId, e, tenantRun(who));
      return state(who, id);
    },

    async signUrl(
      who: PackWho,
      id: string,
      returnUrl: string,
      providerKey?: string,
    ): Promise<{ url: string }> {
      const u = new URL(returnUrl);
      if (!/^https?:$/.test(u.protocol) || !RETURN_PATH(id).test(u.pathname))
        throw new ESignFail("VALIDATION", "return_url");
      const e = await openOf(who, id);
      const me = e.signers.find((s) => s.role === "company" && s.client_user_id === who.userId);
      if (!me) throw new ESignFail("ESIGN_NOT_SIGNER", "not-company-signer");
      const p = avail(e.provider);
      if (!p) throw new ESignFail("ESIGN_DISABLED", "provider-unavailable");
      const chosen = signerProvider(e, providerKey);
      const row: EnvelopeRow = chosen
        ? {
            ...e,
            signers: e.signers.map((s) =>
              s === me ? { ...s, provider: chosen, certificate_ref: null } : s,
            ),
          }
        : e;
      u.searchParams.set("esign", "return");
      const url = await p.recipientView(
        e.envelopeId,
        { name: me.name, email: me.email, clientUserId: who.userId },
        u.toString(),
      );
      // esign-fix · ký thử: CHỈ người ký nhúng bấm "Ký ngay" mới hoàn tất (làm mới chỉ đọc trạng thái "đang chờ").
      if (p.demo) {
        const at = (d.now?.() ?? new Date()).toISOString();
        const done = { status: "completed", reason: null, completedAt: at, recipients: [] };
        await sync(who.tenantId, row, tenantRun(who), done);
      } else if (chosen) {
        await d.uow.tenant(who, (r) =>
          r.esign.update(e.envelopeId, {
            status: e.status,
            reason: e.reason,
            completedAt: e.completedAt,
            signers: row.signers,
          }),
        );
      }
      return { url };
    },

    async voidIt(who: PackWho, id: string, reason: string): Promise<ESignStateOut> {
      const e = await openOf(who, id);
      const p = avail(e.provider);
      if (!p) throw new ESignFail("ESIGN_DISABLED", "provider-unavailable");
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
      const p = avail(key);
      if (!p?.webhook) throw new ESignFail("NOT_FOUND", "provider");
      const chk = p.webhook(raw, header);
      if (!chk.ok) throw new ESignFail("ESIGN_WEBHOOK_REJECTED", "signature");
      if (!chk.envelopeId) return "ignored";
      const tid = await d.tenantOf(p.key, chk.envelopeId);
      if (!tid) return "ignored";
      const run: Run = (fn) => d.uow.system(tid, fn);
      const row = await run((r) => r.esign.byEnvelope(chk.envelopeId as string));
      if (!row || row.provider !== p.key) return "ignored";
      await sync(tid, row, run);
      return "ok";
    },
  };
}
export type ESignUsecase = ReturnType<typeof esignUsecase>;
