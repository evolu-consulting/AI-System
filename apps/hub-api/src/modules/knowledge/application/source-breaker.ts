// R1 · F-09 (review CR-095 đợt C) · N4-NFR-01: ngắt mạch nguồn ngoài (KnowledgeHub) để KH chậm/chết không cộng trọn hạn gọi vào
// MỌI lần tìm. `failures` lần lỗi liên tiếp ⇒ mở mạch `coolMs`: `search` ném ngay (0 mạng), bên gọi trả kết quả nội bộ. Hết hạn
// ⇒ cho một lượt thử; thành công ⇒ đóng, lỗi ⇒ mở lại. Đồng hồ tiêm được (test dùng đồng hồ giả, không chờ giờ thật).
import type { ExternalSource } from "./ports";

export type BreakerOpts = { failures?: number; coolMs?: number; now?: () => number };

export class SourceOpenError extends Error {
  override name = "SourceOpenError";
}

export function withBreaker(src: ExternalSource, o: BreakerOpts = {}): ExternalSource {
  const max = o.failures ?? 3;
  const cool = o.coolMs ?? 30_000;
  const now = o.now ?? Date.now;
  let fails = 0;
  let openUntil = 0;
  return {
    name: src.name,
    allows: (t) => src.allows(t),
    async search(query, k, signal) {
      if (fails >= max && now() < openUntil) throw new SourceOpenError(src.name);
      try {
        const hits = await src.search(query, k, signal);
        fails = 0;
        return hits;
      } catch (e) {
        fails++;
        if (fails >= max) openUntil = now() + cool;
        throw e;
      }
    },
  };
}
