// CR-169 · Tin nhắn người–người giữa hai công ty đã kết nối — luật thuần (không đọc DB). Nơi thi hành thật là hàm DEFINER `pmsg_*`
// (hub, migration 0149: ghi «trùng partner.rules.ts»); file này để QC/unit khoá luật. Spec: docs/specs/CR-169/spec.md §3 (P2, P4, P7, P9).
import { z } from "zod";

export type PartnerEnd = { tenantId: string; userId: string };

const norm = (e: PartnerEnd) => `${e.tenantId.toLowerCase()}:${e.userId.toLowerCase()}`;

/** Sắp hai đầu theo (tenant, user) tăng ⇒ khoá cặp ổn định không phụ thuộc ai mở. Cùng công ty ⇒ ném (dùng `direct`, P2). */
export function partnerPair(x: PartnerEnd, y: PartnerEnd): { a: PartnerEnd; b: PartnerEnd } {
  if (x.tenantId.toLowerCase() === y.tenantId.toLowerCase()) {
    throw new Error("partnerPair: hai đầu cùng công ty");
  }
  return norm(x) <= norm(y) ? { a: x, b: y } : { a: y, b: x };
}

/** P7 · chỉ đọc khi hết kết nối HOẶC người kia không còn hợp lệ. */
export function partnerReadOnly(connected: boolean, peerEligible: boolean): boolean {
  return !connected || !peerEligible;
}

/** P4 · lỗi gửi/tải lên; kiểm kết nối trước, rồi người kia. `null` = được gửi. */
export function partnerSendError(
  connected: boolean,
  peerEligible: boolean,
): null | "MSG_NOT_CONNECTED" | "MSG_PEER_INACTIVE" {
  if (!connected) return "MSG_NOT_CONNECTED";
  if (!peerEligible) return "MSG_PEER_INACTIVE";
  return null;
}

export type CompanyFilter =
  | { kind: "all" }
  | { kind: "own" }
  | { kind: "company"; tenantId: string };

const UuidSchema = z.uuid();

/** Vắng/"all" ⇒ all; "own" hoặc = công ty mình ⇒ own; uuid ⇒ company; khác ⇒ ném ZodError (biên ⇒ 400 `VALIDATION`). */
export function parseCompanyFilter(raw: string | undefined, ownTenant: string): CompanyFilter {
  if (raw === undefined || raw === "" || raw === "all") return { kind: "all" };
  if (raw === "own") return { kind: "own" };
  const id = UuidSchema.parse(raw).toLowerCase();
  if (id === ownTenant.toLowerCase()) return { kind: "own" };
  return { kind: "company", tenantId: id };
}

/** P9 · nguồn cuộc cần gộp: nội bộ (`direct`+`group`) và/hoặc `partner`. */
export function sourcesOf(f: CompanyFilter): { internal: boolean; partner: boolean } {
  switch (f.kind) {
    case "all":
      return { internal: true, partner: true };
    case "own":
      return { internal: true, partner: false };
    case "company":
      return { internal: false, partner: true };
  }
}
