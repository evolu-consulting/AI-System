// CR-181 · s8 · cổng «đến lượt ký chưa» (BR-D1): lát s9 cài thật theo trạng thái lượt chạy; phần A dùng `noTurn`.
export type SignTurn = {
  allowed: boolean;
  run_id?: string;
  step?: "approve" | "sign";
  reason?: string;
};
export type SignTurnCtx = { tenantId: string; userId: string };
export type SignTurnPort = {
  /** Người `userId` có đang được giao bước (Duyệt có chữ ký / Ký) của HĐ này không. */
  turnFor(ctx: SignTurnCtx, contractId: string, userId: string): Promise<SignTurn>;
};
/** Cài đặt tạm: chưa ai có lượt ký (⇒ mọi người ngoài người tải lên chỉ xem). */
export const noTurn: SignTurnPort = {
  turnFor: async () => ({ allowed: false, reason: "NO_TURN" }),
};
