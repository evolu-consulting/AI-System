// CR-141 · tải bản đã ký cho bước «Ký hợp đồng» (lớp 2, không SQL). FileBox: put NGOÀI tx, ghi DB sau — DB không nhận ⇒ xoá byte vừa đưa lên.
// Ghi xong ⇒ `after` (bắn `esign.completed` thả bước chờ + huỷ phong bì ký số còn mở nếu có).
import type { PackUow, PackWho } from "../../kit/public";
import { orgForTenant } from "../../kit/public";
import { checkSignedUpload, signedUploadVerdict } from "../domain/sign-upload.rules";

export class SignUploadFail extends Error {
  constructor(
    readonly kind: "not_found" | "forbidden" | "not_awaiting" | "file_type" | "file_content",
  ) {
    super(kind);
  }
}
export type SignedUploadRow = {
  id: string;
  contractId: string;
  org: string;
  fileId: string;
  versionId: string;
  name: string;
  mime: string;
  size: number;
  by: string;
  override: boolean;
  signerName: string;
};
/** Cổng repo (cài ở `adapters/sign-upload.repo.ts`). */
export type SignUploadRepo = {
  /** found=false ⇒ HĐ không thấy. Đang chờ = sự kiện mới nhất trong {mở chờ, đã tải, đã ký số} là «mở chờ». */
  awaiting(contractId: string): Promise<{ found: boolean; awaiting: boolean; signers: string[] }>;
  /** Ghi tệp + phong bì «upload» đã hoàn tất + dòng lịch sử; bước đã xong ⇒ false. */
  insertSigned(r: SignedUploadRow): Promise<boolean>;
};
type R = { signUpload: SignUploadRepo };

export function signUploadUsecase(d: {
  uow: PackUow<R>;
  files: {
    put(
      org: string,
      name: string,
      bytes: Uint8Array,
    ): Promise<{ fileId: string; versionId: string }>;
    remove(org: string, fileId: string): Promise<void>;
  };
  me: (who: PackWho) => Promise<{ name: string }>;
  newId: () => string;
  /** Huỷ phong bì ký số đang mở (nếu có) — TRƯỚC khi ghi bản tải lên (sau đó `latest` là phong bì «upload», không còn thấy phong bì mở). Lỗi ⇒ nuốt. */
  voidOpen: (who: PackWho, contractId: string) => Promise<void>;
  /** Sau khi ghi: thả bước chờ (`signedAt` ISO) + dọn phong bì ký số còn mở. Lỗi ở đây không làm mất bản đã lưu. */
  after: (who: PackWho, contractId: string, data: Record<string, string>) => Promise<void>;
}) {
  return {
    /** Trạng thái cho nút «Tải lên bản đã ký»: bước đang chờ + người xem có được tải không. */
    async state(who: PackWho, id: string, admin: boolean) {
      const s = await d.uow.tenant(who, (r) => r.signUpload.awaiting(id));
      if (!s.found) throw new SignUploadFail("not_found");
      const v = signedUploadVerdict({
        awaiting: s.awaiting,
        assigned: s.signers,
        userId: who.userId,
        admin,
      });
      return { awaiting: s.awaiting, can_upload: v.ok, override: v.ok && v.override };
    },
    async upload(who: PackWho, id: string, f: { name: string; bytes: Uint8Array }, admin: boolean) {
      const chk = checkSignedUpload(f.name, f.bytes);
      if (!chk.ok) throw new SignUploadFail(chk.reason === "ext" ? "file_type" : "file_content");
      const mime = chk.mime;
      const s = await d.uow.tenant(who, (r) => r.signUpload.awaiting(id));
      if (!s.found) throw new SignUploadFail("not_found");
      const v = signedUploadVerdict({
        awaiting: s.awaiting,
        assigned: s.signers,
        userId: who.userId,
        admin,
      });
      if (!v.ok) throw new SignUploadFail(v.reason);
      const org = orgForTenant(who.tenantId);
      const put = await d.files.put(org, f.name, f.bytes);
      const row = {
        id: d.newId(),
        contractId: id,
        org,
        fileId: put.fileId,
        versionId: put.versionId,
        name: f.name,
        mime,
        size: f.bytes.byteLength,
        by: who.userId,
        override: v.override,
        signerName: (await d.me(who)).name,
      };
      await d.voidOpen(who, id);
      const ok = await d.uow
        .tenant(who, (r) => r.signUpload.insertSigned(row))
        .catch(async (e) => {
          await d.files.remove(org, put.fileId);
          throw e;
        });
      if (!ok) {
        await d.files.remove(org, put.fileId);
        throw new SignUploadFail("not_awaiting");
      }
      await d.after(who, id, {
        envelope_id: row.id,
        signed_at: new Date().toISOString(),
        signer: row.signerName,
      });
      return { id: row.id, name: row.name, override: v.override };
    },
  };
}
export type SignUploadUsecase = ReturnType<typeof signUploadUsecase>;
