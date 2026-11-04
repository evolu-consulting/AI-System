// CR-118 · cr118-community-files · §11.1: service tệp bài (T-DEP-1: route chỉ gọi service). Upload: sniff theo nội dung
// (`ATTACH_ALLOWED`) → byte lên FileBox NGOÀI tx → MỘT câu ghi hàng (lỗi ⇒ xoá byte). Tải: MỘT câu đọc hàng dưới RLS người xem
// (`files_visible`) → byte từ kho NGOÀI tx. Không thấy ⇒ `NOT_FOUND` (giống hệt mọi lý do).
import { ATTACH_ALLOWED, ATTACH_MAX_BYTES } from "@ai/contracts";
import type { CommunityFile } from "@ai/contracts/community";
import type { Tx } from "@ai/db";
import { AppError, appError } from "../../../../lib/errors";
import type { PackUow } from "../../kit/application/ports";
import type { CommunityBlobs } from "../application/pack-ports";
import { downloadHeaders, sniffMime } from "../domain/file.rules";
import type { Access } from "./community-access";
import { insertFile, visibleFile } from "./files.repo";

export const FILE_MAX_BYTES = ATTACH_MAX_BYTES;

type Uow = PackUow<{ tx: Tx }>;

const need = (b: CommunityBlobs | undefined): CommunityBlobs => {
  if (!b) throw new AppError("FILES_UNAVAILABLE", 503, "File storage is not configured");
  return b;
};

/** `name` đã làm sạch (`safeFileName`). Nội dung không khớp đuôi cho phép ⇒ 415. */
export async function upload(
  uow: Uow,
  blobs: CommunityBlobs | undefined,
  a: Access,
  name: string,
  bytes: Uint8Array,
): Promise<CommunityFile> {
  const store = need(blobs);
  const mime = sniffMime(name, bytes, ATTACH_ALLOWED);
  if (!mime) throw appError("ATTACHMENT_TYPE_NOT_ALLOWED");
  const t = a.who.tenantId;
  const up = await store.put(t, name, bytes);
  try {
    const id = await uow.tenant(a.who, ({ tx }) =>
      insertFile(tx, {
        tenantId: t,
        fileId: up.fileId,
        versionId: up.versionId,
        name,
        mime,
        size: bytes.length,
        createdBy: a.who.userId,
      }),
    );
    return { id, name, mime, size: bytes.length };
  } catch (e) {
    await store.drop(t, up.fileId).catch(() => {}); // không để byte mồ côi ở kho
    throw e;
  }
}

export async function download(
  uow: Uow,
  blobs: CommunityBlobs | undefined,
  a: Access,
  id: string,
): Promise<Response> {
  const store = need(blobs);
  const row = await uow.tenant(a.who, ({ tx }) => visibleFile(tx, a.who.tenantId, id));
  if (!row) throw appError("NOT_FOUND");
  const bytes = await store.get(a.who.tenantId, row.file_id);
  if (!bytes) throw appError("NOT_FOUND");
  return new Response(bytes, {
    status: 200,
    headers: downloadHeaders({ name: row.name, mime: row.mime, size: bytes.length }),
  });
}
