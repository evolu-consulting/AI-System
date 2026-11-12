// CR-133 · nối «Tài liệu kèm» (lớp 4 của gói): `PackUow` (role `contracts_rw`) + FileBox org `t_<tenant>` (cùng kho file chính) + cổng hub đọc tệp kèm
// các lượt duyệt của HĐ (`recordRunFiles`, qua cửa public của module attachments). Gắn dưới `/pack/contracts` ở `packs.mount.ts` (chỉ khi có FileBox).
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import { recordRunFiles } from "../../attachments/public";
import type { PackAccessView, PackFileboxClient, PackGuardVars } from "../kit/public";
import { createPackUow, packTenantOnly } from "../kit/public";
import { contractFilesRepo } from "./adapters/contract-files.repo";
import { contractFilesRoutes } from "./adapters/contract-files.routes";
import { contractRoleOf } from "./adapters/contract-role";
import { contractFilesUsecases } from "./application/contract-files.usecase";
import { contractsMaxBytes } from "./upload.mount";

export function contractFilesModule(
  db: Db,
  view: PackAccessView,
  filebox: (org: string) => PackFileboxClient,
): Hono<PackGuardVars> {
  const uc = contractFilesUsecases({
    uow: packTenantOnly(
      createPackUow(db, "contracts", (tx, t) => ({ contractFiles: contractFilesRepo(tx, t) })),
    ),
    files: {
      put: (org, name, bytes) => filebox(org).postFile(name, bytes),
      remove: async (org, fileId) => {
        await filebox(org).deleteFile(fileId);
      },
    },
    stepFiles: (w, contractId) =>
      recordRunFiles(db, w, { packKey: "contracts", recordId: contractId }),
    link: (org, fileId) => filebox(org).getLink(fileId),
    newId: () => Bun.randomUUIDv7(),
  });
  return contractFilesRoutes(view, uc, contractRoleOf(view), contractsMaxBytes());
}
