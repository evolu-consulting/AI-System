// HD-FR-07 · HD-AC01 · D-13 · HD1 plan §2 §6: văn bản Markdown của HĐ (`source_text`, ≤ 5 MB) — MỘT câu SQL trong tx RLS
// `PackUow`. id lạ / tenant khác / chưa có source ⇒ `null` (route ⇒ 404 giống hệt).
import type { PackUow, PackWho } from "../../kit/application/ports";
import type { ContractsReadRepo } from "./ports";

export type GetSource = (who: PackWho, id: string) => Promise<string | null>;

export function getSource(d: {
  uow: PackUow<{ contracts: Pick<ContractsReadRepo<unknown, unknown>, "source"> }>;
}): GetSource {
  return (who, id) => d.uow.tenant(who, (r) => r.contracts.source(id));
}
