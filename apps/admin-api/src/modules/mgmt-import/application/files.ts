// I1 · niti-attach · file HĐ: đọc nguồn (sha256 đối soát) ⇒ CHỈ HĐ chưa có file mới tải lên kho đích (FileBox org `t_<tenant>`).
// HĐ mới: hàng `contracts.files` đi theo lô trước HĐ (HĐ mang `file_id`). HĐ ĐÃ nhập trước đó không file (lượt "chưa có FileBox"):
// tải lên rồi `attachFiles` (MỘT câu: chèn hàng file + gắn `file_id` khi còn null — cùng tx) ⇒ chạy lại không tải lại, không đè
// file gắn sau. Trạng thái đích đọc MỘT câu mỗi tenant (`contractFiles`); dry-run/không kho đích ⇒ chỉ đếm `pending`.
import type { FileJob } from "../domain/map-contracts.rules";
import { type Plan, push, type Row } from "../domain/plan";
import type { ContractFileState, ImportDeps, ImportOpts } from "./ports";

/** HĐ đã có file (bỏ qua) · tải lên · gắn vào HĐ đã có · còn chờ file (không kho đích / dry-run). */
export type FileStats = {
  jobs: number;
  has_file: number;
  uploaded: number;
  attached: number;
  pending: number;
};
/** `out`: id hàng file ⇒ sha256 bytes nguồn (đối soát). */
export type FileWork = { jobs: FileJob[]; out: Map<string, string> };

async function currentFiles(
  d: ImportDeps,
  jobs: FileJob[],
): Promise<Map<string, ContractFileState>> {
  const by = new Map<string, FileJob[]>();
  for (const j of jobs) by.set(j.tenantId, [...(by.get(j.tenantId) ?? []), j]);
  const cur = new Map<string, ContractFileState>();
  for (const [tid, js] of by) {
    const pairs = js.map((j) => ({ contract_id: j.contractId, file_row_id: j.fileRowId }));
    for (const [k, v] of await d.target.contractFiles(tid, pairs)) cur.set(k, v);
  }
  return cur;
}

const fileRow = (j: FileJob, up: { fileId: string; versionId: string | null }, size: number) => ({
  id: j.fileRowId,
  org: `t_${j.tenantId}`,
  file_id: up.fileId,
  version_id: up.versionId,
  name: j.name,
  mime: j.mime,
  size_bytes: size,
  created_by: j.createdBy,
});

type Ctx = {
  d: ImportDeps;
  plan: Plan;
  st: FileStats;
  attach: Map<string, Row[]>;
};

/** Một việc file đã đọc được bytes, apply + có kho đích. */
async function place(c: Ctx, j: FileJob, now: ContractFileState, bytes: Uint8Array) {
  const sink = c.d.files.sink;
  const t = c.plan.tenants.get(j.tenantId);
  if (!sink || !t) return;
  const upload = async () => {
    c.st.uploaded++;
    return fileRow(j, await sink.put(`t_${j.tenantId}`, j.name, bytes), bytes.byteLength);
  };
  if (now.exists) {
    // HĐ đã ở đích, chưa file: hàng file đã có (lượt trước đứt giữa chừng) ⇒ chỉ gắn; chưa ⇒ tải lên rồi gắn
    const row = now.fileRow ? { id: j.fileRowId, file_id: null } : await upload();
    const list = c.attach.get(j.tenantId) ?? [];
    list.push({ ...row, contract_id: j.contractId });
    c.attach.set(j.tenantId, list);
    return;
  }
  const k = (t.rows["contracts.contracts"] ?? []).find((x) => x.id === j.contractId);
  if (k) k.file_id = j.fileRowId;
  if (!now.fileRow) push(t, "contracts.files", await upload());
}

export async function moveFiles(
  d: ImportDeps,
  o: Pick<ImportOpts, "apply" | "batch">,
  plan: Plan,
  w: FileWork,
): Promise<FileStats> {
  const st: FileStats = { jobs: w.jobs.length, has_file: 0, uploaded: 0, attached: 0, pending: 0 };
  const c: Ctx = { d, plan, st, attach: new Map() };
  const cur = await currentFiles(d, w.jobs);
  for (const j of w.jobs) {
    const f = d.files.source ? await d.files.source.readDir(j.dir) : null;
    if (!f) {
      plan.issues.push({ entity: "file", ref: j.dir, code: "FILE_MISSING" });
      continue;
    }
    w.out.set(j.fileRowId, new Bun.CryptoHasher("sha256").update(f.bytes).digest("hex"));
    const now = cur.get(j.contractId) ?? { exists: false, fileId: null, fileRow: false };
    if (now.fileId) st.has_file++;
    else if (!o.apply || !d.files.sink) st.pending++;
    else await place(c, j, now, f.bytes);
  }
  for (const [tid, rows] of c.attach)
    for (let i = 0; i < rows.length; i += o.batch)
      st.attached += await d.target.attachFiles(tid, rows.slice(i, i + o.batch));
  return st;
}
