// HD-FR-08 · HD-AC09…AC11 · HD-NFR-03 · D-06 · D-09 · plan §5: tải lên hợp đồng. Thứ tự: magic bytes (415) → kind/parent (422)
// → 1 pipeline quota (vượt ⇒ hoàn + 429; lỗi Redis ⇒ 503) → DOCX → FileBox (org `t_<tenant>`) → tx 3 câu (set_config + CTE
// files/contracts/events + outbox) → sau commit `ExtractionStarter`. Lỗi sau INCR ⇒ hoàn quota + gỡ tệp đã lưu.

import { orgForTenant } from "../../kit/application/pack-files.ports";
import type { PackWho } from "../../kit/application/ports";
import type { DocxConverter } from "../../kit/domain/docx.rules";
import { fillFields } from "../domain/fields.rules";
import { nextDayStart } from "../domain/quota-reset.rules";
import { quotaVerdict, type SniffedType, sniffFileType, uploadDay } from "../domain/upload.rules";
import {
  type ContractFileStore,
  type ExtractionStarter,
  type UploadCounter,
  type UploadDays,
  UploadError,
  type UploadStatus,
  type UploadUow,
} from "./upload-contract.ports";

export const UPLOAD_MIME: Record<SniffedType, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpeg: "image/jpeg",
  png: "image/png",
};
const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04];

export type UploadContractDeps = {
  uow: UploadUow;
  counter: UploadCounter;
  files: ContractFileStore;
  docx: DocxConverter;
  starter: ExtractionStarter;
  zipNames: (bytes: Uint8Array) => string[];
  limits: { tenant: number; global: number };
  newId: () => string;
  now?: () => Date;
};

export type UploadContractInput = {
  who: PackWho;
  timeZone: string;
  bytes: Uint8Array;
  name: string;
  title: string;
  kind: "contract" | "appendix";
  parentId: string | null;
};
export type UploadContractResult = { id: string; status: UploadStatus; version: number };
export type UploadContract = (i: UploadContractInput) => Promise<UploadContractResult>;

/** Loại tệp theo nội dung; zip chỉ đọc central directory khi 4 byte đầu là `PK\x03\x04`. */
export function sniffUpload(bytes: Uint8Array, zipNames: (b: Uint8Array) => string[]) {
  const zip = ZIP_SIG.every((b, i) => bytes[i] === b);
  return sniffFileType(bytes, zip ? zipNames(bytes) : undefined);
}

export function createUploadContract(d: UploadContractDeps): UploadContract {
  const now = d.now ?? (() => new Date());
  return async (i) => {
    const type = sniffUpload(i.bytes, d.zipNames);
    if (!type) throw new UploadError("FILE_TYPE");
    if ((i.kind === "appendix") !== (i.parentId !== null)) throw new UploadError("PARENT_INVALID");
    const at = now();
    const days: UploadDays = { tenant: uploadDay(at, i.timeZone), global: uploadDay(at, "UTC") };
    await takeQuota(d, i, days, at);
    let stored: { org: string; fileId: string } | null = null;
    try {
      const text = await toText(d.docx, type, i.bytes);
      const org = orgForTenant(i.who.tenantId);
      const up = await d.files.put(org, i.name, i.bytes);
      stored = { org, fileId: up.fileId };
      const row = await persist(d, i, { type, text, org, ...up });
      await d.starter.start(i.who, row.id).catch(() => undefined); // sau commit; lỗi không huỷ tải lên
      return row;
    } catch (e) {
      await d.counter.refund(i.who.tenantId, days).catch(() => undefined);
      if (stored) await d.files.remove(stored.org, stored.fileId).catch(() => undefined);
      throw e;
    }
  };
}

type Stored = { type: SniffedType; text: Text; org: string; fileId: string; versionId: string };
/** Một tx: `set_config` + một CTE (files → contracts → events) + outbox = 3 câu. */
function persist(
  d: UploadContractDeps,
  i: UploadContractInput,
  s: Stored,
): Promise<UploadContractResult> {
  return d.uow.tenant(i.who, async (r) => {
    const out = await r.upload.insert({
      id: d.newId(),
      fileRowId: d.newId(),
      org: s.org,
      fileId: s.fileId,
      versionId: s.versionId,
      name: i.name,
      mime: UPLOAD_MIME[s.type],
      size: i.bytes.byteLength,
      kind: i.kind,
      parentId: i.parentId,
      title: i.title,
      status: s.text.ok ? "extracting" : "extract_failed",
      error: s.text.ok ? null : "DOCX_UNREADABLE",
      fields: fillFields({}),
      sourceText: s.text.ok ? s.text.markdown : null,
      userId: i.who.userId,
    });
    await r.outbox.enqueue([{ entity: "contract", entity_id: out.id, op: "upsert" }]);
    return out;
  });
}

async function takeQuota(
  d: UploadContractDeps,
  i: UploadContractInput,
  days: UploadDays,
  at: Date,
): Promise<void> {
  let c: { tenant: number; global: number };
  try {
    c = await d.counter.take(i.who.tenantId, days);
  } catch {
    throw new UploadError("UPLOAD_QUOTA_UNAVAILABLE");
  }
  const v = quotaVerdict(c, d.limits);
  if (v === "ok") return;
  await d.counter.refund(i.who.tenantId, days).catch(() => undefined);
  const tz = v === "tenant" ? i.timeZone : "UTC";
  throw new UploadError("UPLOAD_QUOTA", {
    scope: v,
    limit: d.limits[v],
    resets_at: nextDayStart(at, tz).toISOString(),
  });
}

type Text = { ok: true; markdown: string | null } | { ok: false };
/** DOCX ⇒ Markdown; `DOCX_BUSY` ⇒ 503 (người gọi hoàn quota); `DOCX_UNREADABLE` ⇒ vẫn lưu, `extract_failed`. */
async function toText(docx: DocxConverter, type: SniffedType, bytes: Uint8Array): Promise<Text> {
  if (type !== "docx") return { ok: true, markdown: null };
  const r = await docx.toMarkdown(bytes);
  if (r.ok) return { ok: true, markdown: r.markdown };
  if (r.code === "DOCX_BUSY") throw new UploadError("DOCX_BUSY");
  return { ok: false };
}
