// esign · lưu "Bản đã ký" vào FileBox (tách khỏi `esign.usecase.ts`, trần 400 dòng). Lớp 2: chỉ cổng.
import { ESignFail } from "./esign.helpers";
import type { EnvelopeRow, ESignFiles, ESignProvider, ESignRepo } from "./esign.ports";

type Run = <T>(fn: (r: { esign: ESignRepo }) => Promise<T>) => Promise<T>;
const baseName = (n: string) => n.replace(/\.pdf$/i, "").slice(0, 150);

/** Lưu "Bản đã ký" (nhà cung cấp ⇒ PDF đã ký; ký thử ⇒ PDF gốc) — mất đua ⇒ xoá tệp vừa đẩy. */
export async function storeSignedFile(
  newId: () => string,
  p: ESignProvider,
  files: ESignFiles,
  tid: string,
  row: EnvelopeRow,
  run: Run,
): Promise<void> {
  const c = await run((r) => r.esign.contract(row.contractId));
  if (!c?.file) return;
  const org = `t_${tid}`;
  const bytes =
    (await p.combinedPdf(row.envelopeId)) ?? (await files(c.file.org).getContent(c.file.fileId));
  if (!bytes) throw new ESignFail("ESIGN_PROVIDER", "signed-pdf-missing");
  const name = `${baseName(c.file.name)}-${p.demo ? "ky-thu" : "da-ky"}.pdf`;
  const up = await files(org).postFile(name, bytes);
  const f = {
    id: newId(),
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
}
