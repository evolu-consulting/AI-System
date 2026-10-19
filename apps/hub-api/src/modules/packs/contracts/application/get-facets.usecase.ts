// HD-FR-07 · D-10 · HD1 plan §1 §6: facets trên CẢ tenant token (không theo bộ lọc) — MỘT câu SQL trong tx RLS `PackUow`.
import type { PackUow, PackWho } from "../../kit/application/ports";
import type { ContractsReadRepo } from "./ports";

export type GetFacets<Facets> = (who: PackWho) => Promise<Facets>;

export function getFacets<Facets>(d: {
  uow: PackUow<{ contracts: Pick<ContractsReadRepo<unknown, Facets>, "facets"> }>;
}): GetFacets<Facets> {
  return (who) => d.uow.tenant(who, (r) => r.contracts.facets());
}
