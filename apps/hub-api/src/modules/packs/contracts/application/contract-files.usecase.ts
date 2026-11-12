// CR-133 · «Tài liệu kèm» trên HĐ — use case (lớp 2, không SQL). Hai nhóm trong MỘT khối: (1) tệp gắn thẳng vào HĐ (`contracts.contract_files`, byte ở
// FileBox cùng kho file chính), (2) tệp kèm các bước duyệt (đọc từ hub qua cổng `stepFiles`, chỉ đọc). Quyền: xem = thấy HĐ (RLS); gắn = quyền sửa HĐ;
// gỡ = quyền sửa HĐ hoặc người đã gắn tệp. FileBox: put NGOÀI tx, ghi DB sau — DB không nhận (đủ trần / HĐ mất) ⇒ xoá byte vừa đưa lên.
import type { PackUow, PackWho } from "../../kit/public";
import { orgForTenant } from "../../kit/public";
import {
  type ContractFileFacts,
  canAddContractFile,
  canRemoveContractFile,
  groupContractFiles,
  MAX_CONTRACT_FILES,
  mimeByName,
  type OwnFileRow,
  type StepFileRow,
} from "../domain/contract-files.rules";
import type { DeleteRole } from "../domain/delete-contract.rules";
import type { ContractFileStore } from "./upload-contract.ports";

export type NewContractFile = {
  id: string;
  contractId: string;
  org: string;
  fileId: string;
  versionId: string;
  name: string;
  mime: string;
  size: number;
};
export type ContractFileRef = { org: string; file_id: string; added_by: string };

export type ContractFilesRepo = {
  /** Người tạo / phụ trách của HĐ (RLS: không thấy ⇒ null). */
  facts(contractId: string): Promise<ContractFileFacts | null>;
  list(contractId: string): Promise<OwnFileRow[]>;
  count(contractId: string): Promise<number>;
  /** Một câu: HĐ còn thấy + chưa đủ trần ⇒ ghi `files` + `contract_files`; trả false khi không ghi. */
  insert(r: NewContractFile, by: string): Promise<boolean>;
  find(contractId: string, fileId: string): Promise<ContractFileRef | null>;
  /** Gỡ liên kết + đánh dấu `files.deleted_at`; trả false khi không có. */
  remove(contractId: string, fileId: string): Promise<boolean>;
};
export type ContractFilesRepos = { contractFiles: ContractFilesRepo };

export class ContractFilesFail extends Error {
  constructor(readonly kind: "not_found" | "forbidden" | "file_type" | "full") {
    super(kind);
  }
}

export type ContractFilesUsecases = ReturnType<typeof contractFilesUsecases>;

export function contractFilesUsecases(d: {
  uow: PackUow<ContractFilesRepos>;
  files: ContractFileStore;
  /** Tệp kèm các lượt duyệt của HĐ mà người gọi xem được (hub). */
  stepFiles: (who: PackWho, contractId: string) => Promise<StepFileRow[]>;
  link: ((org: string, fileId: string) => Promise<string | null>) | null;
  newId: () => string;
}) {
  return {
    /** null = HĐ không thấy (404). Mỗi nhóm một câu SQL (không N+1). */
    async list(who: PackWho, id: string, role: DeleteRole) {
      const own = await d.uow.tenant(who, async (r) => {
        const facts = await r.contractFiles.facts(id);
        return facts ? { facts, rows: await r.contractFiles.list(id) } : null;
      });
      if (!own) return null;
      const steps = await d.stepFiles(who, id);
      return {
        ...groupContractFiles(own.rows, steps, (by) =>
          canRemoveContractFile(own.facts, by, who.userId, role),
        ),
        can_add: canAddContractFile(own.facts, who.userId, role),
      };
    },
    async add(who: PackWho, id: string, role: DeleteRole, f: { name: string; bytes: Uint8Array }) {
      const mime = mimeByName(f.name);
      if (!mime) throw new ContractFilesFail("file_type");
      const n = await d.uow.tenant(who, async (r) => {
        const facts = await r.contractFiles.facts(id);
        if (!facts) throw new ContractFilesFail("not_found");
        if (!canAddContractFile(facts, who.userId, role)) throw new ContractFilesFail("forbidden");
        return r.contractFiles.count(id);
      });
      if (n >= MAX_CONTRACT_FILES) throw new ContractFilesFail("full");
      const org = orgForTenant(who.tenantId);
      const put = await d.files.put(org, f.name, f.bytes);
      const row: NewContractFile = {
        id: d.newId(),
        contractId: id,
        org,
        fileId: put.fileId,
        versionId: put.versionId,
        name: f.name,
        mime,
        size: f.bytes.byteLength,
      };
      const ok = await d.uow
        .tenant(who, (r) => r.contractFiles.insert(row, who.userId))
        .catch(async (e) => {
          await d.files.remove(org, put.fileId);
          throw e;
        });
      if (!ok) {
        await d.files.remove(org, put.fileId);
        throw new ContractFilesFail("full");
      }
      return { id: row.id, name: row.name, mime, size: row.size };
    },
    async remove(who: PackWho, id: string, fileId: string, role: DeleteRole) {
      await d.uow.tenant(who, async (r) => {
        const facts = await r.contractFiles.facts(id);
        const ref = facts ? await r.contractFiles.find(id, fileId) : null;
        if (!facts || !ref) throw new ContractFilesFail("not_found");
        if (!canRemoveContractFile(facts, ref.added_by, who.userId, role))
          throw new ContractFilesFail("forbidden");
        if (!(await r.contractFiles.remove(id, fileId))) throw new ContractFilesFail("not_found");
      });
    },
    /** Link tải ngắn hạn (FileBox); không thấy HĐ / tệp ⇒ null. */
    async link(who: PackWho, id: string, fileId: string): Promise<string | null> {
      const ref = await d.uow.tenant(who, (r) => r.contractFiles.find(id, fileId));
      if (!ref || ref.org !== orgForTenant(who.tenantId)) return null;
      if (!d.link) throw new Error("filebox not configured");
      return d.link(ref.org, ref.file_id);
    },
  };
}
