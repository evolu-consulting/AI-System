// com-c8-host-read · cổng đọc sổ chủ quản: kiểm người gọi (nội bộ + quyền đọc gói) TRƯỚC khi mở tx; 2 câu SQL cố định (ứng viên tên,
// kho/giá) trong MỘT tx của người gọi + điểm uy tín theo tập khoá đối tác (engine hiện hành) — Luật 4c: không theo cỡ lô.
import type { PackUow, PackWho } from "../../kit/application/ports";
import { HOST_BATCH_MAX, isUuid, pickMatch } from "../domain/host-book.rules";
import {
  HostBookError,
  type HostBookOut,
  type HostBookReader,
  type HostBookRepo,
  type HostCaller,
} from "./host-book.ports";

type Rep = { score: number | null; level: "good" | "fair" | "watch" | "new" };
export type HostBookDeps = {
  uow: PackUow<{ hostBook: HostBookRepo }>;
  /** Người dùng có quyền đọc gói contracts (nhóm được giao `contracts-read`). */
  canRead: (who: PackWho) => Promise<boolean>;
  reputation: (who: PackWho) => Promise<ReadonlyMap<string, Rep>>;
};

export function hostBookUsecase(d: HostBookDeps): HostBookReader {
  return {
    async read(caller, q) {
      if (caller.kind === "external") throw new HostBookError("forbidden");
      const who: PackWho = { tenantId: caller.tenantId, userId: caller.userId };
      if (!(await d.canRead(who))) throw new HostBookError("forbidden");
      if (q.hints.length > HOST_BATCH_MAX) throw new HostBookError("too_many");
      if (q.hints.some((h) => h.productId !== undefined && !isUuid(h.productId)))
        throw new HostBookError("invalid");
      const partyKeys = [...new Set(q.partyKeys ?? [])].slice(0, HOST_BATCH_MAX);

      const { picks, book } = await d.uow.tenant(who, async (r) => {
        const cands = await r.hostBook.candidates(q.hints);
        const picks = q.hints.map((h, i) => pickMatch(h, cands.get(i) ?? []));
        const ids = [...new Set(picks.flatMap((p) => (p ? [p.product.id] : [])))];
        return { picks, book: await r.hostBook.book(ids) };
      });
      const reps = partyKeys.length > 0 ? await d.reputation(who) : new Map<string, Rep>();
      const out: HostBookOut = {
        products: q.hints.map((hint, index) => {
          const p = picks[index] ?? null;
          const b = p ? book.get(p.product.id) : undefined;
          return {
            index,
            hint,
            match: p
              ? { id: p.product.id, name: p.product.name, unit: p.product.unit, how: p.how }
              : null,
            onHand: b?.onHand ?? null,
            avgCost: b?.avgCost ?? null,
            prices: b?.prices ?? [],
          };
        }),
        partners: partyKeys.map((partyKey) => {
          const r = reps.get(partyKey);
          return { partyKey, band: r?.level ?? null, score: r?.score ?? null };
        }),
      };
      return out;
    },
  };
}

export type { HostCaller };
