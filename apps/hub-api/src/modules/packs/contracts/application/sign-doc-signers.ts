// Danh sách người ký của phiên ký trên tài liệu (tách khỏi `sign-doc.usecase.ts` cho đủ ≤ 400 dòng; không đổi hành vi).
import type { SignSignerOut } from "@ai/contracts/pack-contracts";
import type { SignBehalf } from "../domain/sign-turn.port";
import type { PartnerSigner } from "./sign-doc.ports";

/** Người ký công ty của bước Ký (Q2): người cụ thể hoặc nhóm. `mine` (tuỳ chọn) = người gọi thuộc nhóm đó. */
export type CompanySigner = {
  kind: "user" | "group";
  id: string;
  name: string;
  mine?: boolean;
  /** Kiểu nhóm: thành viên (tên) để nói đích danh người ký tiếp. */
  members?: { id: string; name: string }[];
};

/** Danh sách người ký (Q2): Bên A = từng người / «Đại diện <nhóm>»; Bên B = liên hệ đầu tiên có email. */
export function buildSigners(
  company: readonly CompanySigner[],
  partner: PartnerSigner | null,
  me: string,
  behalf: readonly SignBehalf[] = [],
): SignSignerOut[] {
  const a: SignSignerOut[] = company.map((c) =>
    c.kind === "user"
      ? {
          side: "A",
          kind: "user",
          ref: c.id,
          name: c.name,
          mine: c.id === me || behalf.some((b) => b.user_id === c.id),
        }
      : {
          side: "A",
          kind: "group",
          ref: c.id,
          name: `Đại diện ${c.name}`,
          mine: c.mine === true || behalf.some((b) => b.groups.includes(c.id)),
          ...(c.members?.length ? { members: c.members } : {}),
        },
  );
  const email = partner?.email?.trim().toLowerCase();
  const b: SignSignerOut[] = email
    ? [
        {
          side: "B",
          kind: "partner",
          ref: email,
          name: partner?.name?.trim() || partner?.partner_name?.trim() || email,
          mine: false,
        },
      ]
    : [];
  return [...a, ...b];
}
