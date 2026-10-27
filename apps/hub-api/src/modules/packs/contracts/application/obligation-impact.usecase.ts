// MS-impact · CR-101b (R18, R19, R34): xem trước tác động THẬT khi xác nhận một mốc (không ghi). Số câu cố định, MỘT đối tác × MỘT vai:
// (1) đầu đợt + công nợ + quá hạn treo — một câu; rồi SONG SONG (2) uy tín theo engine hiện hành — V2-E: cấu hình + 2 câu chấm lọc
// đối tác; HD8: 3 câu của `partners.one` (lọc theo vai) — và (3) kho (mốc giao: 2 câu). Engine chấm lại đầu vào đã thêm đúng phần mà
// `settle` sẽ ghi (luật ở `domain/obligation-impact.rules.ts`) ⇒ cùng số với bảng điểm sau khi xác nhận. Lớp 2: không SQL.
import type { PackUow, PackWho } from "../../kit/application/ports";
import { localDate } from "../domain/local-time.rules";
import {
  debtAfter,
  type Fault,
  hd8After,
  hd8Event,
  hd8Point,
  type ImpactHead,
  type RepImpact,
  type StockImpact,
  settleFacts,
  stockAfter,
  v2eContribution,
  v2eWith,
} from "../domain/obligation-impact.rules";
import { board, type Rows } from "../domain/rep-board.rules";
import { cellKey, REP_CELLS } from "../domain/rep-config.rules";
import type { RepEngine } from "../domain/rep-current.rules";
import type { Agg, Window } from "../domain/scoring-agg.rules";
import type { Role } from "../domain/scoring-config.rules";
import type { DeliveryRepo } from "./delivery.ports";
import { plannedMoves } from "./delivery.usecase";
import type { ReputationUsecase } from "./reputation.usecase";

export class ImpactFail extends Error {
  constructor(readonly kind: "not_found" | "done") {
    super(kind);
  }
}

type PartyScore = { score: number | null; band: string | null } | null;
export type ImpactDeps = {
  uow: PackUow<{
    impact: { head(id: string): Promise<ImpactHead | null> };
    delivery: DeliveryRepo;
  }>;
  v2e: Pick<ReputationUsecase, "scored">;
  hd8: {
    editedScore(
      who: PackWho,
      party: string,
      role: Role,
      edit: (a: Agg, w: Window) => Agg,
    ): Promise<{ before: PartyScore; after: PartyScore }>;
  };
  engine: () => RepEngine;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now: () => Date;
};
type Ctx = { who: PackWho; h: ImpactHead; party: string; at: string; fault: Fault | null };

async function v2eImpact(d: ImpactDeps, x: Ctx): Promise<RepImpact | null> {
  const cell = x.h.rep_cell ? REP_CELLS[x.h.rep_cell - 1] : undefined;
  if (!cell) return null;
  const [grp, role] = cell;
  const s = await d.v2e.scored(x.who, [role], x.party);
  const cfg = s.cfg.cells[cellKey(grp, role)];
  if (!cfg) return null;
  const pick = (rows: Rows) => board(rows, s.cfg, [role]).find((p) => p.party === x.party);
  const add = v2eContribution(x.h, x.at, x.fault, s.day, cfg);
  const key = `${x.party}\u0001${x.h.rep_cell}`;
  const after: Rows = add
    ? {
        names: s.rows.names,
        inputs: new Map(s.rows.inputs).set(
          key,
          v2eWith(s.rows.inputs.get(key), { party: x.party, role, grp }, add),
        ),
      }
    : s.rows;
  const b = pick(s.rows);
  const a = pick(after);
  return {
    engine: "v2e",
    role,
    party: x.party,
    before: { score: b?.score ?? null, level: b?.level ?? "new" },
    after: { score: a?.score ?? null, level: a?.level ?? "new" },
    counted: add !== null,
    pending_fault: x.fault === "unknown",
  };
}

async function hd8Impact(d: ImpactDeps, x: Ctx): Promise<RepImpact | null> {
  const ev = { ...hd8Event(x.h, x.at), at: x.at };
  let inWin = false;
  const r = await d.hd8.editedScore(x.who, x.party, ev.role, (agg, w) => {
    inWin = x.at >= w.start && x.at <= w.today;
    return hd8After(agg, ev, ev.role, w, x.h.overdue);
  });
  if (!r.before && !r.after) return null;
  return {
    engine: "hd8",
    role: ev.role,
    party: x.party,
    before: hd8Point(r.before),
    after: hd8Point(r.after),
    counted: inWin,
    pending_fault: x.fault === "unknown",
  };
}

async function stockOf(d: ImpactDeps, who: PackWho, h: ImpactHead): Promise<StockImpact[]> {
  if (h.kind !== "delivery") return [];
  return d.uow.tenant(who, async ({ delivery }) => {
    const L = await delivery.load(h.id);
    if (!L) return [];
    const moves = plannedMoves(L, h.id);
    if (!moves.length) return [];
    const ids = new Set(moves.map((m) => m.componentId));
    const products = [...new Set(L.comps.filter((c) => ids.has(c.id)).map((c) => c.product_id))];
    return stockAfter(moves, await delivery.stockOf(products));
  });
}

export function obligationImpact(d: ImpactDeps) {
  /** Xem trước. `fault`/`actual_on` như thân `settle` (vắng ngày ⇒ hôm nay theo lịch tenant). Đợt đã xong ⇒ `done`. */
  const preview = async (
    who: PackWho,
    id: string,
    q: { fault?: Fault | undefined; actual_on?: string | undefined },
  ) => {
    const today = localDate(d.now(), await d.timeZoneOf(who.tenantId));
    const at = q.actual_on ?? today;
    const h = await d.uow.tenant(who, (r) => r.impact.head(id));
    if (!h) throw new ImpactFail("not_found");
    if (h.status !== "open") throw new ImpactFail("done");
    const f = settleFacts(h, at, q.fault);
    const x = h.party ? { who, h, party: h.party, at, fault: f.fault } : null;
    const [reputation, stock] = await Promise.all([
      x ? (d.engine() === "v2e" ? v2eImpact(d, x) : hd8Impact(d, x)) : null,
      stockOf(d, who, h),
    ]);
    return {
      obligation_id: h.id,
      at,
      late: f.late,
      fault: f.fault,
      reputation,
      stock,
      debt: debtAfter(h),
    };
  };
  /**
   * Delta lưu trên dòng sổ khi xác nhận (lỗi đọc ⇒ null: không chặn xác nhận). CHỈ engine `v2e` (đọc lọc một đối tác, ~5 câu theo chỉ
   * mục): HD8 đọc sổ/HĐ/giá cả tenant theo vai ⇒ đặt trên đường xác nhận phá ngưỡng V2-D (p95 ≤ 50 ms, không Seq Scan) ⇒ không lưu.
   */
  const deltaFor = async (
    who: PackWho,
    id: string,
    at: string,
    fault: Fault | null | undefined,
  ) => {
    if (d.engine() !== "v2e") return null;
    const out = await preview(who, id, { actual_on: at, fault: fault ?? undefined }).catch(
      () => null,
    );
    const r = out?.reputation;
    return r ? { engine: r.engine, role: r.role, before: r.before, after: r.after } : null;
  };
  return { preview, deltaFor };
}
export type ObligationImpact = ReturnType<typeof obligationImpact>;
