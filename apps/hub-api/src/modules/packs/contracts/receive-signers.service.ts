// CR-146b · người ký bên NHẬN («Ký cùng lúc») = «Người ký phía công ty» của bước Ký trong quy trình Nhận HĐ. Route đi qua service này (không chạm repo).
import type { Db } from "@ai/db";
import { receiveFlowOf, signerMembersOf } from "./adapters/receive-flow.repo";

/** `null` ⇒ quy trình Nhận HĐ chưa có bước Ký / chưa chọn người ký; ngược lại danh sách người ký còn dùng được. */
export async function receiveSignerMembers(
  db: Db,
  tenantId: string,
): Promise<{ id: string; name: string }[] | null> {
  const { signers } = await receiveFlowOf(db, tenantId);
  return signers ? signerMembersOf(db, tenantId, signers) : null;
}
