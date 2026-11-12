// CR-130 · ADR-0043 (tách khỏi flows.service.ts cho ≤ 400 dòng): liên kết tài khoản công ty với đối tác SHT khi duyệt yêu cầu tham gia.
import type { Tx } from "@ai/db";
import { AppError } from "../../../../lib/errors";
import type { PartnerLinker } from "../application/pack-ports";
import { rolesOfLabels } from "../domain/audience.rules";
import type { Access } from "./community-access";
import type * as repo from "./flows.repo";

/** CR-130: duyệt ⇒ vai (nhãn xin `customer` = vai SHT) + hồ sơ đối tác ở SHT qua cổng `PartnerLinker`, CÙNG tx quyết. */
export async function linkJoined(
  partners: PartnerLinker | undefined,
  tx: Tx,
  a: Access,
  row: repo.JoinRow,
  partyKey: string | undefined,
): Promise<void> {
  if (!partners) throw new AppError("PARTNER_LINK_UNAVAILABLE", 503, "Partner linking unavailable");
  try {
    await partners.linkInTx(
      tx,
      { tenantId: a.who.tenantId, kind: a.who.userKind === "external" ? "external" : "internal" },
      {
        extOrgId: row.requester_org,
        name: row.company,
        roles: rolesOfLabels(row.labels),
        partyKey: partyKey ?? null,
      },
    );
  } catch (e) {
    // so khớp theo `kind` (không `instanceof`, như cổng báo giá); lỗi lạ ném tiếp ⇒ rollback cả lượt duyệt
    const k = (e as { kind?: string }).kind;
    if (k === "already_linked")
      throw new AppError(
        "PARTNER_ALREADY_LINKED",
        409,
        "Partner is already linked to another account",
      );
    if (k === "not_found") throw new AppError("PARTNER_NOT_FOUND", 422, "Partner not found");
    if (k === "org_forbidden") throw new AppError("PACK_FORBIDDEN", 403, "Forbidden");
    throw e;
  }
}
