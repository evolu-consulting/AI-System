// CR-127 · B0 · sự kiện đã khai ở manifest nhưng CHƯA có nguồn phát (X2/X3/K6/E10 làm đầy đủ): đăng ký bộ đọc dữ kiện rỗng + xử lý kết
// quả "chưa hỗ trợ" để kiểm tra lúc khởi động (`MOD_EVENT_UNBOUND`/`MOD_OUTCOME_UNBOUND`) không chặn hub. Chỉ lấp sự kiện CHƯA có
// binding thật (tra `flowPortRegistry`) ⇒ chạy SAU `mountContractFlow`; lát nào thêm binding thật thì sự kiện đó tự rời khỏi danh sách.
// TODO(CR-127): gỡ file này khi X2/X3/K6/E10 xong (mọi sự kiện manifest có binding thật).
import { CONTRACTS_MANIFEST } from "@ai/contracts/app-manifest";
import type { Tx } from "@ai/db";
import { flowPortRegistry, moduleRegistry } from "../kit/public";

const PACK = "contracts";

/** Sự kiện manifest có dữ kiện/kết quả mà chưa có bộ đọc / xử lý thật. */
export function unsourcedEvents(): { facts: string[]; outcomes: string[] } {
  const facts: string[] = [];
  const outcomes: string[] = [];
  for (const e of CONTRACTS_MANIFEST.events) {
    if (e.facts.length > 0 && !flowPortRegistry.factsReaderFor(PACK, e.key)) facts.push(e.key);
    if (e.outcomes.length > 0 && !flowPortRegistry.outcomeHandlerFor(PACK, e.key))
      outcomes.push(e.key);
  }
  return { facts, outcomes };
}

export function bindUnsourcedContractEvents(): void {
  const { facts, outcomes } = unsourcedEvents();
  if (facts.length > 0)
    moduleRegistry.bindEvent({
      // Chưa có nguồn phát ⇒ không bản ghi nào gắn với sự kiện này: "không thấy" (null) như bản ghi ngoài tenant.
      facts: { packKey: PACK, events: facts, read: async () => null },
    });
  if (outcomes.length > 0)
    moduleRegistry.bindEvent<Tx>({
      outcome: {
        packKey: PACK,
        events: outcomes,
        apply: async (_tx, input) => {
          throw new Error(`contracts outcome chưa hỗ trợ: ${input.event} · ${input.outcome}`);
        },
      },
    });
}
