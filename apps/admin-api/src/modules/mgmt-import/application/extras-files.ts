// niti-import2 · file chat ⇒ đính kèm hub trên FileBox (org = `FILEBOX_ORG` của hub, như upload của chat): đọc bytes nguồn (sha256),
// chỉ tải lên đính kèm CHƯA có ở đích; dry-run / không kho đích ⇒ chỉ đếm `pending` (hàng đính kèm không ghi — lượt sau gắn).
// Đối soát: đọc lại bytes từ FileBox theo hàng đích, so sha256 cột `hub.attachments.sha256` với bytes nguồn.
import type { ChatFileJob, ConvUnit } from "../domain/extras-chat.rules";
import type { Issue } from "../domain/values.rules";
import type { ExtrasDeps, ExtrasState } from "./extras-ports";

const MAX = 20_971_520;
type Row = Record<string, unknown>;
const sha = (b: Uint8Array) => new Bun.CryptoHasher("sha256").update(b).digest("hex");

export type ExtraFileStats = {
  jobs: number;
  found: number;
  uploaded: number;
  existing: number;
  pending: number;
  unsupported: string[];
  checksum_ok: number;
  checksum_bad: number;
};

type Place = {
  tid: string;
  uid: string;
  apply: boolean;
  org: string | null;
  units: ConvUnit[];
  issues: Issue[];
};
type Out = { rows: Map<string, Row[]>; shas: Map<string, string>; present: Set<string> };

/** Bytes nguồn hợp lệ của một file chat (vắng / sai cỡ ⇒ vấn đề + null). */
async function bytesOf(d: ExtrasDeps, j: ChatFileJob, issues: Issue[]): Promise<Uint8Array | null> {
  const f = d.chatFiles ? await d.chatFiles.readDir(j.dir) : null;
  if (!f) issues.push({ entity: "chat_file", ref: j.dir, code: "FILE_MISSING" });
  else if (f.bytes.byteLength < 1 || f.bytes.byteLength > MAX)
    issues.push({ entity: "chat_file", ref: j.dir, code: "CHAT_FILE_SIZE" });
  else return f.bytes;
  return null;
}

async function placeOne(
  d: ExtrasDeps,
  x: Place,
  u: ConvUnit,
  j: ChatFileJob,
  st: ExtraFileStats,
  o: Out,
) {
  const bytes = await bytesOf(d, j, x.issues);
  if (!bytes) return;
  st.found++;
  const id = String(j.row.id);
  const h = sha(bytes);
  o.shas.set(id, h);
  if (o.present.has(id)) st.existing++;
  else if (!x.apply || !d.sink || !x.org) st.pending++;
  else {
    const up = await d.sink.put(x.org, String(j.row.filename), bytes);
    st.uploaded++;
    const list = o.rows.get(String(u.conv.id)) ?? [];
    list.push({
      ...j.row,
      size: bytes.byteLength,
      sha256: h,
      filebox_file_id: up.fileId,
      filebox_version_id: up.versionId,
    });
    o.rows.set(String(u.conv.id), list);
  }
}

/** Hàng đính kèm sẵn sàng ghi theo đơn vị (id đơn vị = id hội thoại) + sha nguồn theo id đính kèm. */
export async function placeChatFiles(
  d: ExtrasDeps,
  x: Place,
  st: ExtraFileStats,
): Promise<{ rows: Map<string, Row[]>; shas: Map<string, string> }> {
  const all = x.units.flatMap((u) => u.files);
  st.jobs = all.length;
  const ids = all.map((j) => String(j.row.id));
  const o: Out = {
    rows: new Map(),
    shas: new Map(),
    present: x.apply ? await d.store.attachmentsPresent(x.tid, x.uid, ids) : new Set(),
  };
  for (const u of x.units) for (const j of u.files) await placeOne(d, x, u, j, st, o);
  return { rows: o.rows, shas: o.shas };
}

/** sha256 đọc lại từ FileBox ↔ cột sha256 của hàng ↔ bytes nguồn. */
export async function chatChecksums(
  d: ExtrasDeps,
  org: string | null,
  st: ExtrasState,
  shas: Map<string, string>,
): Promise<{ ok: number; bad: number }> {
  const out = { ok: 0, bad: 0 };
  if (!d.sink || !org) return out;
  for (const a of st.attachments) {
    const bytes = a.file_id ? await d.sink.readBack(a.file_id, org) : null;
    const got = bytes ? sha(bytes) : null;
    const want = shas.get(a.id) ?? a.sha256;
    if (got && got === a.sha256 && got === want) out.ok++;
    else out.bad++;
  }
  return out;
}
