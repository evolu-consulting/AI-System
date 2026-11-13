// CR-141 · nối use case tải bản đã ký (tách khỏi `esign.mount.ts` cho đủ ≤ 400 dòng). Cần FileBox; vắng ⇒ null (không có route).
// Ghi xong ⇒ thả bước chờ `esign.completed` (cùng đường ký số xong) rồi huỷ phong bì ký số còn mở (không bắn `esign.voided`).
import type { Db, Tx } from "@ai/db";
import { logger } from "../../../lib/logger";
import type { PackAccessView, PackWho } from "../kit/public";
import { createPackUow } from "../kit/public";
import { contractRoleOf } from "./adapters/contract-role";
import { signUploadRepo } from "./adapters/sign-upload.repo";
import { signUploadRoutes } from "./adapters/sign-upload.routes";
import type { ESignFiles } from "./application/esign.ports";
import { type SignUploadUsecase, signUploadUsecase } from "./application/sign-upload.usecase";
import type { CompletedHook } from "./esign.mount";
import { contractsMaxBytes } from "./upload.mount";

export function signUploadOf(
  db: Db,
  files: ESignFiles | null,
  me: (who: PackWho) => Promise<{ name: string }>,
  hooks: { completed: CompletedHook; voidIt: (who: PackWho, id: string) => Promise<void> },
): SignUploadUsecase | null {
  if (!files) return null;
  return signUploadUsecase({
    uow: createPackUow(db, "contracts", (tx: Tx, t: string) => ({
      signUpload: signUploadRepo(tx, t),
    })),
    files: {
      put: (org, name, bytes) => files(org).postFile(name, bytes),
      remove: async (org, fileId) => {
        await files(org).deleteFile(fileId);
      },
    },
    me,
    newId: () => Bun.randomUUIDv7(),
    after: async (who, id, data) => {
      const warn = (m: string) => (e: unknown) =>
        logger.warn(m, { contract_id: id, error: e instanceof Error ? e.name : "unknown" });
      await Promise.resolve(hooks.completed(who.tenantId, id, "esign.completed", data)).catch(
        warn("sign-upload-hook-failed"),
      );
      await hooks.voidIt(who, id).catch(() => undefined);
    },
  });
}

/** Route tải bản đã ký (guard `write`; tải tối đa như tải HĐ). */
export const signUploadRoutesOf = (view: PackAccessView, uc: SignUploadUsecase) =>
  signUploadRoutes(view, uc, contractRoleOf(view), contractsMaxBytes());
