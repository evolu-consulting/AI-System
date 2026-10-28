// com-c8-host-read · ADR-0031: dựng cổng đọc `HostBookReader` (lớp 4). CHƯA nối Community — `packs.mount.ts` sẽ gọi hàm này và bọc
// adapter thoả port của community. Quyền: người gọi phải có việc `read` của gói contracts (nhóm được giao) — user ngoài bị chặn ở usecase.
import type { Db } from "@ai/db";
import { type PackAccessView, packAccessInput } from "../kit/adapters/pack-guard.middleware";
import { createPackUow } from "../kit/adapters/pack-uow";
import type { PackWho } from "../kit/application/ports";
import { packActionsFor } from "../kit/domain/pack-access.rules";
import { hostBookRepo } from "./adapters/host-book.repo";
import type { HostBookReader } from "./application/host-book.ports";
import { hostBookUsecase } from "./application/host-book.usecase";

const KEY = "contracts";

export function hostBookModule(
  db: Db,
  view: PackAccessView,
  d: {
    reputation: (
      who: PackWho,
    ) => Promise<
      ReadonlyMap<string, { score: number | null; level: "good" | "fair" | "watch" | "new" }>
    >;
  },
): HostBookReader {
  const uow = createPackUow(db, KEY, (tx, t) => ({ hostBook: hostBookRepo(tx, t) }));
  return hostBookUsecase({
    uow,
    reputation: d.reputation,
    canRead: async (who) => packActionsFor(await packAccessInput(view, KEY, who)).includes("read"),
  });
}
