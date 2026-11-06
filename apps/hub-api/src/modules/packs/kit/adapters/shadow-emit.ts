// CR-122 · M1 · phát sự kiện flow khi cờ `FLOW_TRIGGERS` TẮT = chỉ để ghi bóng ⇒ lỗi của nó KHÔNG được làm hỏng tx ghi hợp đồng/bài.
// Chạy trong SAVEPOINT của drizzle (`tx.transaction` ⇒ `sql.savepoint` của postgres.js): lỗi ⇒ rollback về savepoint, ghi log cảnh báo (chỉ
// tên lỗi + sự kiện, không PII), tx bản ghi chạy tiếp. BẪY: `SAVEPOINT` viết tay KHÔNG đủ — postgres.js ghi nhớ mọi truy vấn lỗi của `begin`
// và ném lại lúc kết thúc dù đã bắt; chỉ savepoint của chính nó cô lập lỗi. `emit` PHẢI dùng tx con nhận được. Cờ bật: không dùng hàm này
// (lỗi phát làm hỏng tx như thiết kế).
import type { Tx } from "@ai/db";
import { logger } from "../../../../lib/logger";

export async function shadowEmit(
  tx: Tx,
  event: string,
  emit: (sp: Tx) => Promise<unknown>,
): Promise<void> {
  try {
    await tx.transaction(async (sp) => {
      await emit(sp as unknown as Tx);
    });
  } catch (e) {
    logger.warn("flow-shadow-emit-failed", {
      event,
      error: e instanceof Error ? e.name : "unknown",
    });
  }
}
