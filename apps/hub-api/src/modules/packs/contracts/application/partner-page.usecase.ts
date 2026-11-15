// CR-151e · danh sách Đối tác phân trang ở máy chủ cho CẢ HAI engine (HD8 / V2-E). Điểm do engine hiện hành tính một lần bằng số câu SQL
// cố định (`rows`, cùng nguồn `supplierScores`/`scoreOf`); lọc (vai / CHÚ Ý / cờ đỏ), tìm tên, sắp xếp, cắt trang là luật thuần dùng chung với
// web (`partner-party.ts`); số HĐ chỉ tra cho đối tác TRONG TRANG (một câu, tham số JSON). Chỉ trang được trả về — không gửi cả bảng.
import {
  filterParties,
  type PartnerContractCount,
  type PartyPage,
  type PartyPageQuery,
  pageParties,
  partiesOf,
  type ScoreRow,
  sortParties,
} from "@ai/contracts/pack-contracts";
import type { PackWho } from "../../kit/public";

export type PartnerPageDeps = {
  rows: (who: PackWho) => Promise<ScoreRow[]>;
  counts: (who: PackWho, parties: readonly string[]) => Promise<PartnerContractCount[]>;
};

export function partnerPageUsecase(d: PartnerPageDeps) {
  return {
    page: async (who: PackWho, q: PartyPageQuery): Promise<PartyPage> => {
      const all = partiesOf(await d.rows(who));
      const p = pageParties(
        sortParties(filterParties(all, q.filter, q.q), q.sort),
        q.limit,
        q.offset,
      );
      const n = new Map(
        (
          await d.counts(
            who,
            p.items.map((i) => i.party),
          )
        ).map((c) => [c.party, c.n]),
      );
      return { ...p, items: p.items.map((i) => ({ ...i, contracts: n.get(i.party) ?? 0 })) };
    },
  };
}
export type PartnerPageUsecase = ReturnType<typeof partnerPageUsecase>;
