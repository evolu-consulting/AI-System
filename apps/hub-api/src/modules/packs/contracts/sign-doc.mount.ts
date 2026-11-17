// CR-181 · s8 phần A · nối «Ký trên tài liệu» (lớp lắp ráp): `PackUow` role `contracts_rw` + FileBox đọc tệp để đếm trang. Gói không import module hub
// (luật pack-no-hub-modules-any-layer) ⇒ thiết lập công ty, người ký của bước Ký và cổng lượt ký do `packs.sign-doc.ts` tiêm. Gắn dưới `/pack/contracts`.
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import type { PackAccessView, PackFileboxClient, PackGuardVars } from "../kit/public";
import { createPackUow, packTenantOnly } from "../kit/public";
import { contractFilesRepo } from "./adapters/contract-files.repo";
import { signDocRepo } from "./adapters/sign-doc.repo";
import { signDocRoutes } from "./adapters/sign-doc.routes";
import { signDocsRepo } from "./adapters/sign-docs.repo";
import { signFieldsRepo } from "./adapters/sign-fields.repo";
import { probePdf } from "./adapters/sign-pdf-probe";
import { signVersionsRepo } from "./adapters/sign-versions.repo";
import { type CompanySigner, signDocUsecases } from "./application/sign-doc.usecase";
import { noTurn, type SignTurnPort } from "./domain/sign-turn.port";
import { contractsMaxBytes } from "./upload.mount";

export type SignDocPorts = {
  /** Thiết lập công ty: «Ký trên tài liệu» đang bật (Q5). */
  onDocEnabled: (who: { tenantId: string; userId: string }) => Promise<boolean>;
  /** Người ký công ty của bước Ký (Q2). */
  companySigners: (
    who: { tenantId: string; userId: string },
    contractId: string,
  ) => Promise<CompanySigner[]>;
  /** Lát s9 cài thật; vắng ⇒ `noTurn`. */
  turn?: SignTurnPort;
};

export function signDocModule(
  db: Db,
  view: PackAccessView,
  filebox: (org: string) => PackFileboxClient,
  ports: SignDocPorts,
): Hono<PackGuardVars> {
  const uc = signDocUsecases({
    uow: packTenantOnly(
      createPackUow(db, "contracts", (tx, t) => ({
        contractFiles: contractFilesRepo(tx, t),
        signDoc: signDocRepo(tx, t),
        docs: signDocsRepo(tx, t),
        fields: signFieldsRepo(tx, t),
        versions: signVersionsRepo(tx, t),
      })),
    ),
    files: { read: (org, boxId, max) => filebox(org).getContent(boxId, max) },
    maxBytes: contractsMaxBytes(),
    probePdf,
    companySigners: ports.companySigners,
    onDocEnabled: ports.onDocEnabled,
    turn: ports.turn ?? noTurn,
    newId: () => Bun.randomUUIDv7(),
  });
  return signDocRoutes(view, uc);
}
