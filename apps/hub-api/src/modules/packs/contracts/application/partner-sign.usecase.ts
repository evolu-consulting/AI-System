// CR-182 · đợt 2 · «Đối tác ký qua link riêng» (BR-C5), lớp 2 (không SQL). Ba phần:
//   · tạo + gửi link (`ensureLink`): sau khi Bên A ký đủ mà HĐ còn chỗ ký Bên B (tự động) hoặc «Gửi lại» (thu hồi link cũ);
//   · các lời gọi công khai theo BĂM token (`view/content/quick/sign/decline`) — hub lo hạn mức/CSRF/PNG, đây lo dữ liệu;
//   · hoàn tất: Bên B ký đủ ⇒ chốt link + thả bước Ký (HĐ «Đã ký») + chuông + thư; từ chối ⇒ chuông kèm lý do.
// Số câu SQL cố định, không theo số chỗ ký. Mạng (FileBox, SMTP) NGOÀI tx.
import type {
  PartnerDeclineBody,
  PartnerLinkStatusOut,
  PartnerQuickMethod,
  PartnerSignBody,
  PartnerSignFileOut,
  PartnerSignSaveOut,
  PartnerSignViewOut,
} from "@ai/contracts/pack-contracts";
import { PARTNER_SIGN_ERRORS as E } from "@ai/contracts/pack-contracts";
import type { PackWho, SignLinkFail, SignLinkResult } from "../../kit/public";
import {
  canResendLink,
  hashLinkToken,
  inviteMail,
  linkAccess,
  linkExpiry,
  newLinkToken,
  partnerOpenFields,
  signedMail,
  signLinkUrl,
  statusOut,
} from "../domain/partner-sign.rules";
import type { PartnerSignDeps, PartnerSignRepos } from "./partner-sign.deps";
import type { ContactRow, LinkRow } from "./partner-sign.repo.port";
import { sendMail } from "./partner-sign-mail";
import { partnerSignSave } from "./partner-sign-save";

const fail = (status: SignLinkFail["status"], code: string): SignLinkFail => ({
  ok: false,
  status,
  code,
});
const iso = (d: Date | string | null): string | null => (d ? new Date(d).toISOString() : null);

export class PartnerSignFail extends Error {
  constructor(readonly kind: "not_found" | "forbidden" | "no_contact" | "not_needed") {
    super(kind);
  }
}

export type PartnerSignUsecases = ReturnType<typeof partnerSignUsecases>;

export function partnerSignUsecases(d: PartnerSignDeps) {
  /** Tra link + kiểm trạng thái. `write` ⇒ link phải còn `open` (đã ký/từ chối ⇒ 409; hết hạn/thu hồi ⇒ 410). */
  async function resolve(th: string, o: { audit: boolean; write: boolean }) {
    const l = await d.lookup((r) => r.open(th, o.audit));
    if (!l) return fail(404, "NOT_FOUND");
    const acc = linkAccess(l.state);
    if (acc === "gone") return fail(410, E.gone);
    if (acc === "closed" && o.write) return fail(409, E.closed);
    return l;
  }
  const isFail = (x: LinkRow | SignLinkFail): x is SignLinkFail => "ok" in x;

  const mail = (...a: Parameters<typeof sendMail> extends [unknown, ...infer R] ? R : never) =>
    sendMail(d, ...a);

  /** Tạo link + gửi «Mời ký». `force` ⇒ thu hồi link cũ (Gửi lại); không ⇒ đã có link chưa chốt thì thôi. */
  async function ensureLinkFull(
    tenantId: string,
    contractId: string,
    o: { by: string | null; force: boolean; stepDueAt?: Date | null },
  ): Promise<{ res: "created" | "exists" | "no_contact"; url: string | null; sent: boolean }> {
    const no = (res: "exists" | "no_contact") => ({ res, url: null, sent: false });
    const token = newLinkToken();
    const hash = await hashLinkToken(token);
    const linkId = d.newId();
    const made = await d.uow.system(tenantId, async (r) => {
      const c = await r.partnerSign.contract(contractId);
      if (!c) return "none" as const;
      await r.partnerSign.lock(contractId);
      if (!o.force && (await r.partnerSign.hasActive(contractId))) return "exists" as const;
      const contact = await r.partnerSign.firstContact(contractId);
      if (!contact) {
        await r.notify.enqueue([
          {
            user_id: c.created_by,
            kind: "contract.partner_sign_nocontact",
            title: `Chưa mời được đối tác ký: ${c.title}`.slice(0, 200),
            body: "Đối tác chưa có liên hệ nào có email. Thêm liên hệ rồi bấm «Gửi lại link ký».",
            link: `/contracts/${contractId}`,
            dedup_key: `partner-sign-nocontact:${contractId}`,
          },
        ]);
        return "no_contact" as const;
      }
      if (o.force) await r.partnerSign.revokeActive(contractId);
      const expires = linkExpiry(o.stepDueAt, d.now());
      await r.partnerSign.insert({
        id: linkId,
        contractId,
        contactId: contact.id,
        hash,
        expiresAt: expires,
        by: o.by ?? c.created_by,
      });
      const docs = await r.docs.listByContract(contractId);
      const fields = await r.fields.listByContract(contractId);
      const need = new Set(docs.filter((x) => x.needs_sign).map((x) => x.file_id));
      return {
        c,
        contact,
        expires,
        nFiles: need.size,
        nFields: fields.filter((f) => f.side === "B" && need.has(f.file_id)).length,
      };
    });
    if (made === "none") return no("no_contact");
    if (typeof made === "string") return no(made);
    const link = signLinkUrl(d.baseUrl(), token);
    const sent = await mail(
      tenantId,
      made.contact,
      `partner-sign-${linkId}`,
      inviteMail({
        companyName: made.c.company_name,
        contractTitle: made.c.title,
        files: made.nFiles,
        fields: made.nFields,
        expiresAt: made.expires,
        link,
      }),
      link,
      linkId,
    );
    if (sent) await d.uow.system(tenantId, (r) => r.partnerSign.markSent(linkId));
    // Có transport mà thư không đi ⇒ báo người tải lên (chuông) — không để HĐ chờ trong im lặng.
    else if (d.mailer()) await mailFailedBell(tenantId, contractId, made.c, linkId);
    return { res: "created", url: link, sent };
  }
  /** Chuông «Chưa gửi được thư mời ký»: người tải lên sửa email liên hệ rồi bấm «Gửi lại link ký». */
  const mailFailedBell = (
    tenantId: string,
    contractId: string,
    c: { title: string; created_by: string },
    linkId: string,
  ) =>
    d.uow
      .system(tenantId, (r) =>
        r.notify.enqueue([
          {
            user_id: c.created_by,
            kind: "contract.partner_sign_mail_failed",
            title: `Chưa gửi được thư mời ký: ${c.title}`.slice(0, 200),
            body: "Thư mời không tới được địa chỉ email của liên hệ đối tác. Kiểm tra email liên hệ rồi bấm «Gửi lại link ký».",
            link: `/contracts/${contractId}`,
            dedup_key: `partner-sign-mailfail:${linkId}`,
          },
        ]),
      )
      .catch(() => undefined);
  const ensureLink = async (...a: Parameters<typeof ensureLinkFull>) =>
    (await ensureLinkFull(...a)).res;

  /** Tải mọi dữ kiện tệp của HĐ cho đối tác: tệp «Cần ký», chỗ ký, bản mới nhất. Ba câu cố định. */
  const snapshot = (r: PartnerSignRepos, contractId: string) =>
    Promise.all([
      r.signDoc.files(contractId),
      r.docs.listByContract(contractId),
      r.fields.listByContract(contractId),
      r.versions.latestByContract(contractId),
    ]);

  /** Sau COMMIT của lần Lưu cuối: thả bước Ký (HĐ «Đã ký», Hồ sơ duyệt lập theo đường DONE) + thư cho đối tác (link xem bản đã ký). */
  async function finished(l: LinkRow, title: string, company: string, contact: ContactRow | null) {
    await d.complete(l.tenant_id, l.contract_id).catch((e: unknown) =>
      d.log.warn("partner-sign-complete-failed", {
        contract_id: l.contract_id,
        error: e instanceof Error ? e.name : "unknown",
      }),
    );
    if (!contact) return;
    const nFiles = await d.uow
      .system(
        l.tenant_id,
        async (r) =>
          (await r.docs.listByContract(l.contract_id)).filter((x) => x.needs_sign).length,
      )
      .catch(() => 0);
    await mail(
      l.tenant_id,
      contact,
      `partner-signed-${l.link_id}`,
      signedMail({ companyName: company, contractTitle: title, files: nFiles }),
      null,
      l.link_id,
    );
  }

  /** Chỉ thả khi bước Ký đang chờ thuộc ĐÚNG lượt đã ký của link (`linkRun`) — không thả nhầm bước Ký `ondoc` kế tiếp của lượt khác. */
  async function recover(
    tenantId: string,
    contractId: string,
    linkRun: string | null,
  ): Promise<void> {
    try {
      const c = await d.counts(tenantId, contractId);
      if (linkRun && c?.a_done && c.b_open === 0 && c.run_id === linkRun)
        await d.complete(tenantId, contractId);
    } catch (e) {
      d.log.warn("partner-sign-recover-failed", { error: e instanceof Error ? e.name : "unknown" });
    }
  }

  return {
    ensureLink,

    /** Phía công ty · «Gửi lại link ký»: người tải lên HĐ hoặc quản trị; thu hồi link cũ, tạo link mới, gửi lại. */
    async resend(who: PackWho, contractId: string, admin: boolean) {
      const info = await d.uow.tenant(who, async (r) => {
        const c = await r.partnerSign.contract(contractId);
        if (!c) return null;
        return {
          c,
          latest: await r.partnerSign.latest(contractId),
          fields: await r.fields.listByContract(contractId),
        };
      });
      if (!info) throw new PartnerSignFail("not_found");
      if (!canResendLink({ userId: who.userId, uploaderId: info.c.created_by, isAdmin: admin }))
        throw new PartnerSignFail("forbidden");
      // Chỉ khi còn chỗ Bên B chưa ký VÀ (đã từng gửi link, hoặc Bên A đã ký đủ).
      const counts = await d.counts(who.tenantId, contractId);
      const bOpen = partnerOpenFields(info.fields);
      if (bOpen === 0 || !(info.latest || counts?.a_done)) throw new PartnerSignFail("not_needed");
      const { res, url, sent } = await ensureLinkFull(who.tenantId, contractId, {
        by: who.userId,
        force: true,
      });
      if (res === "no_contact") throw new PartnerSignFail("no_contact");
      const link = await d.uow.tenant(who, (r) => r.partnerSign.latest(contractId));
      if (!link) throw new PartnerSignFail("not_found");
      return {
        sent: link.sent_at !== null,
        // Thư không gửi được (tắt thông báo / lỗi SMTP) ⇒ trả link gốc MỘT lần cho người có quyền gửi lại để sao chép (DB chỉ giữ băm).
        url: sent ? null : url,
        expires_at: new Date(link.expires_at).toISOString(),
        link: statusOut(link),
      };
    },

    /** Phía công ty · trạng thái link mới nhất của HĐ (quyền xem HĐ; HĐ không thấy ⇒ null). */
    async status(
      who: PackWho,
      contractId: string,
    ): Promise<{ link: PartnerLinkStatusOut | null } | null> {
      const out = await d.uow.tenant(who, async (r) => {
        if (!(await r.contractFiles.facts(contractId))) return null;
        const l = await r.partnerSign.latest(contractId);
        const run = l?.state === "signed" ? await r.partnerSign.signedRun(contractId) : null;
        return { link: l ? statusOut(l) : null, run };
      });
      // Tự phục hồi (soát #4): đối tác đã ký đủ mà bước Ký vẫn chờ (thả bước lỗi lần trước) ⇒ thả lại (`completed` idempotent).
      if (out?.link?.state === "signed") await recover(who.tenantId, contractId, out.run);
      return out && { link: out.link };
    },

    // ---------------- công khai (theo BĂM token) ----------------
    async view(th: string, o: { audit: boolean }): Promise<SignLinkResult<PartnerSignViewOut>> {
      const l = await resolve(th, { audit: o.audit, write: false });
      if (isFail(l)) return l;
      const out = await d.uow.system(l.tenant_id, async (r) => {
        const c = await r.partnerSign.contract(l.contract_id);
        const contact = await r.partnerSign.contact(l.contact_id, l.contract_id);
        const [files, docs, fields, latest] = await snapshot(r, l.contract_id);
        return { c, contact, files, docs, fields, latest };
      });
      if (!out.c) return fail(404, "NOT_FOUND");
      const need = new Set(out.docs.filter((x) => x.needs_sign).map((x) => x.file_id));
      const files: PartnerSignFileOut[] = out.files
        .filter((f) => need.has(f.file_id))
        .map((f) => {
          const v = out.latest.find((x) => x.file_id === f.file_id);
          return {
            file_id: f.file_id,
            name: f.name,
            pages: out.docs.find((x) => x.file_id === f.file_id)?.pages ?? null,
            fields: out.fields
              .filter((x) => x.file_id === f.file_id && x.side === "B")
              .map((x) => ({
                id: x.id,
                label: x.label,
                parts: x.parts,
                signed: x.signed_version_id !== null,
              })),
            latest_version_id: v?.id ?? null,
            latest_seq: v?.seq ?? 0,
          };
        });
      return {
        ok: true,
        data: {
          state: l.state === "signed" ? "signed" : l.state === "declined" ? "declined" : "open",
          company_name: out.c.company_name,
          contract_title: out.c.title,
          contact_name: out.contact?.name?.trim() || out.contact?.partner_name || "",
          expires_at: new Date(l.expires_at).toISOString(),
          signed_at: iso(l.signed_at),
          declined_at: iso(l.declined_at),
          decline_reason: l.decline_reason,
          has_quick_signature: l.quick_id !== null,
          quick_method: l.quick_method,
          files,
        },
      };
    },

    async content(th: string, fileId: string, versionId: string | null) {
      const l = await resolve(th, { audit: false, write: false });
      if (isFail(l)) return l;
      const ref = await d.uow.system(l.tenant_id, async (r) => {
        const [files, docs] = await Promise.all([
          r.signDoc.files(l.contract_id),
          r.docs.listByContract(l.contract_id),
        ]);
        const f = files.find((x) => x.file_id === fileId);
        if (!f || !docs.some((x) => x.file_id === fileId && x.needs_sign)) return null; // tệp không được gửi ⇒ 404
        if (versionId) return r.partnerSign.versionOut(l.contract_id, fileId, versionId);
        const v = await r.versions.latest(l.contract_id, fileId);
        return (
          (v ? await r.signDoc.outFileById(v.out_file_id) : null) ?? {
            org: f.org,
            box_id: f.box_id,
            name: f.name,
          }
        );
      });
      if (!ref) return fail(404, "NOT_FOUND");
      const bytes = await d.files.read(ref.org, ref.box_id, d.maxBytes);
      return bytes
        ? ({ ok: true, data: { bytes, name: ref.name } } as const)
        : fail(404, "NOT_FOUND");
    },

    async quick(th: string, b: { method: PartnerQuickMethod; png: Uint8Array }) {
      const l = await resolve(th, { audit: false, write: true });
      if (isFail(l)) return l;
      const code = await d.lookup((r) =>
        r.quickPut(th, b.method, Buffer.from(b.png).toString("base64")),
      );
      if (code === "ok") return { ok: true, data: { saved: true } } as const;
      if (code === "limit") return fail(409, "SIGN_QUICK_LIMIT");
      return code === "invalid"
        ? fail(404, "NOT_FOUND")
        : code === "gone"
          ? fail(410, E.gone)
          : fail(409, E.closed);
    },

    /** Lưu chữ ký của đối tác: máy chủ in chữ ký nhanh của link (không nhận ảnh); đủ ô Bên B ⇒ chốt link + hoàn tất. */
    async sign(th: string, body: PartnerSignBody): Promise<SignLinkResult<PartnerSignSaveOut>> {
      const l = await resolve(th, { audit: false, write: true });
      if (isFail(l)) return l;
      const quick = await d.lookup((r) => r.quickGet(th));
      if (!quick) return fail(400, E.noQuick);
      return partnerSignSave(d, {
        l,
        th,
        body,
        quick,
        done: (x) => finished(l, x.title, x.company, x.contact),
      });
    },

    async decline(th: string, b: PartnerDeclineBody): Promise<SignLinkResult<{ declined: true }>> {
      const l = await resolve(th, { audit: false, write: true });
      if (isFail(l)) return l;
      const code = await d.uow.system(l.tenant_id, async (r) => {
        const c = await r.partnerSign.contract(l.contract_id);
        const code = await r.partnerSign.finish(th, "decline", b.reason);
        if (code === "ok" && c)
          await r.notify.enqueue([
            {
              user_id: c.created_by,
              kind: "contract.partner_declined",
              title: `Đối tác từ chối ký: ${c.title}`.slice(0, 200),
              body: `Lý do: ${b.reason}`.slice(0, 2000),
              link: `/contracts/${l.contract_id}`,
              dedup_key: `partner-declined:${l.link_id}`,
            },
          ]);
        return code;
      });
      if (code === "ok") return { ok: true, data: { declined: true } };
      return code === "invalid"
        ? fail(404, "NOT_FOUND")
        : code === "gone"
          ? fail(410, E.gone)
          : fail(409, E.closed);
    },
  };
}
