// V2-B · BA v2 §2 (mỗi lần nhập một lô; không giữ hàng ⇒ giá vốn theo đơn) · §5.3 (BQ gia quyền; xuất theo BQ lúc bán) · §5.7 (chặn
// bán vượt tồn khi xác nhận; kho + BQ riêng từng thành phần; gói suất có hạn) — hàm THUẦN lập kế hoạch một lần giao. Không I/O.
// Số học số nguyên: SL ×10⁴ (numeric(18,4)), tiền đồng (bigint). Xuất hết tồn ⇒ lấy đúng giá trị còn (không lệch đồng nào); xuất
// một phần ⇒ làm tròn nửa lên. Gói quota quá hạn (hạn < ngày giao) ⇒ dòng `expire` theo BQ trước mọi dòng của thành phần đó.
import type {
  ComponentChange,
  DeliveryMove,
  DeliveryResult,
  PlannedMove,
  StockMode,
  StockShortage,
} from "./stock.types";

export * from "./stock.types";

export const Q = 10_000n;
export const MONEY_MAX = 1_000_000_000_000_000n;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const QTY = /^\d{1,14}(\.\d{1,4})?$/;

export class StockError extends Error {
  constructor(
    readonly code: "invalid" | "stock_insufficient",
    readonly detail: string,
    readonly shortages: StockShortage[] = [],
  ) {
    super(`${code}: ${detail}`);
    this.name = "StockError";
  }
}

export const parseQty = (s: unknown): bigint | null => {
  if (typeof s !== "string" || !QTY.test(s)) return null;
  const [i = "0", f = ""] = s.split(".");
  const q = BigInt(i) * Q + BigInt(f.padEnd(4, "0"));
  return q > 0n ? q : null;
};
export const fmtQty = (q: bigint): string => {
  const neg = q < 0n;
  const a = neg ? -q : q;
  const f = (a % Q).toString().padStart(4, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${a / Q}${f ? `.${f}` : ""}`;
};
/** ⌊a ÷ b⌉ nửa lên, a ≥ 0, b > 0. */
export const divRound = (a: bigint, b: bigint): bigint => (2n * a + b) / (2n * b);
export const amountOf = (qty: bigint, unitPrice: bigint): bigint => divRound(qty * unitPrice, Q);
/** BQ = giá trị ÷ tồn (đồng/đơn vị); tồn 0 ⇒ giữ BQ cũ. */
export const avgOf = (value: bigint, onHand: bigint, prev: bigint): bigint =>
  onHand > 0n ? divRound(value * Q, onHand) : prev;
/** Giá vốn của `qty` lấy ra khỏi (tồn, giá trị): hết tồn ⇒ đúng giá trị còn. */
export const costOut = (qty: bigint, onHand: bigint, value: bigint): bigint =>
  qty >= onHand ? value : divRound(value * qty, onHand);

export type CompState = {
  id: string;
  productId: string;
  mode: StockMode;
  onHand: bigint;
  value: bigint;
  avg: bigint;
};
export type OpenLot = {
  id: string;
  componentId: string;
  remaining: bigint;
  receivedOn: string;
  expiresOn: string | null;
  seq: number;
};
export type NewLot = {
  id: string;
  componentId: string;
  qty: bigint;
  /** Còn lại ngay khi nhập (vắng ⇒ = qty); nhỏ hơn qty khi hàng nhập bù tồn âm. */
  remaining?: bigint;
  receivedOn: string;
  expiresOn: string | null;
};
export type LotTake = { lotId: string; qty: bigint };
export type CompUpdate = {
  id: string;
  onHand: bigint;
  value: bigint;
  avg: bigint;
  lastMoveId: string;
};
export type DeliveryPlan = {
  lots: NewLot[];
  takes: LotTake[];
  moves: PlannedMove[];
  updates: CompUpdate[];
  result: DeliveryResult;
};

type Ok = {
  m: DeliveryMove;
  c: CompState;
  qty: bigint;
  price: bigint | null;
};

const bad = (detail: string): never => {
  throw new StockError("invalid", detail);
};

function priceOf(m: DeliveryMove, need: boolean, i: number): bigint | null {
  const p = m.unitPrice;
  if (p === undefined || p === null) return need ? bad(`dòng ${i}: thiếu đơn giá`) : null;
  if (!need) return bad(`dòng ${i}: xuất kho lấy giá vốn BQ, không nhận đơn giá`);
  if (!Number.isSafeInteger(p) || p < 0 || BigInt(p) > MONEY_MAX) bad(`dòng ${i}: đơn giá sai`);
  return BigInt(p);
}

/** Kiểm từng dòng (thành phần có, không phải Giới thiệu, SL > 0 tối đa 4 số lẻ, giá/hạn đúng kiểu thành phần). */
export function checkMoves(
  on: string,
  moves: readonly DeliveryMove[],
  comps: ReadonlyMap<string, CompState>,
): Ok[] {
  if (!DATE.test(on) || Number.isNaN(Date.parse(on))) bad("ngày giao sai");
  if (moves.length === 0 || moves.length > 200) bad("số dòng 1…200");
  const dir = new Map<string, string>();
  return moves.map((m, i) => {
    const c = compOf(m, comps, i);
    if ((dir.get(c.id) ?? m.direction) !== m.direction)
      bad(`dòng ${i}: vừa nhập vừa xuất một thành phần`);
    dir.set(c.id, m.direction);
    const qty = parseQty(m.qty) ?? bad(`dòng ${i}: số lượng sai`);
    const price = priceOf(m, m.direction === "in" || c.mode === "order", i);
    if (price !== null && amountOf(qty, price) > MONEY_MAX) bad(`dòng ${i}: thành tiền quá lớn`);
    checkRefs(m, c, on, i);
    return { m, c, qty, price };
  });
}

function compOf(m: DeliveryMove, comps: ReadonlyMap<string, CompState>, i: number): CompState {
  const c =
    typeof m.componentId === "string" && UUID.test(m.componentId)
      ? comps.get(m.componentId)
      : undefined;
  if (!c) return bad(`dòng ${i}: không có thành phần`);
  if (c.mode === "none") bad(`dòng ${i}: SP Giới thiệu không có kho`);
  if (m.direction !== "in" && m.direction !== "out") bad(`dòng ${i}: chiều sai`);
  return c;
}

/** Hạn gói (chỉ `quota`, bắt buộc khi nhập, ≥ ngày giao) + id tham chiếu đúng dạng. */
function checkRefs(m: DeliveryMove, c: CompState, on: string, i: number): void {
  if (m.reason !== undefined && m.reason !== "delivery" && m.reason !== "manual")
    bad(`dòng ${i}: lý do sai`);
  if (m.reason === "manual" && m.direction !== "in") bad(`dòng ${i}: nhập tay chỉ có chiều nhập`);
  const exp = m.expiresOn ?? null;
  if (c.mode !== "quota" && exp !== null) bad(`dòng ${i}: chỉ gói suất có hạn`);
  const needExp = c.mode === "quota" && m.direction === "in";
  if (needExp && (exp === null || !DATE.test(exp) || exp < on))
    bad(`dòng ${i}: gói suất cần hạn ≥ ngày giao`);
  for (const k of ["contractId", "milestoneId", "contractItemId"] as const) {
    const v = m[k];
    if (v !== undefined && v !== null && !UUID.test(v)) bad(`dòng ${i}: ${k} sai`);
  }
}

const lotOrder = (mode: StockMode) => (a: OpenLot, b: OpenLot) =>
  (mode === "quota" ? (a.expiresOn ?? "9999").localeCompare(b.expiresOn ?? "9999") : 0) ||
  a.receivedOn.localeCompare(b.receivedOn) ||
  a.seq - b.seq;

/** Lấy `qty` khỏi các lô theo thứ tự (FIFO / gói hết hạn sớm trước). */
function takeLots(lots: OpenLot[], qty: bigint, takes: LotTake[]): void {
  let left = qty;
  for (const l of lots) {
    if (left === 0n) break;
    const t = l.remaining < left ? l.remaining : left;
    if (t === 0n) continue;
    l.remaining -= t;
    left -= t;
    takes.push({ lotId: l.id, qty: t });
  }
  if (left > 0n) throw new Error("stock: lô lệch tồn (tổng lô còn < tồn)");
}

type Ctx = {
  on: string;
  newId: () => string;
  st: Map<string, CompState>;
  lots: Map<string, OpenLot[]>;
  plan: DeliveryPlan;
};

const n = (x: bigint): number => Number(x);
const snap = (s: CompState) => ({
  onHandBefore: s.mode === "order" ? null : fmtQty(s.onHand),
  valueBefore: s.mode === "order" ? null : n(s.value),
  avgBefore: s.mode === "order" ? null : n(s.avg),
});
const after = (s: CompState) => ({
  onHandAfter: s.mode === "order" ? null : fmtQty(s.onHand),
  valueAfter: s.mode === "order" ? null : n(s.value),
  avgAfter: s.mode === "order" ? null : n(s.avg),
});

function emit(
  x: Ctx,
  s: CompState,
  mv: Omit<
    PlannedMove,
    "id" | "componentId" | keyof ReturnType<typeof snap> | keyof ReturnType<typeof after>
  >,
  apply: () => void,
): void {
  const before = snap(s);
  apply();
  const id = x.newId();
  x.plan.moves.push({ ...mv, ...before, ...after(s), id, componentId: s.id });
  if (s.mode === "stock" || s.mode === "quota") {
    const u = x.plan.updates.find((v) => v.id === s.id);
    const row = { id: s.id, onHand: s.onHand, value: s.value, avg: s.avg, lastMoveId: id };
    if (u) Object.assign(u, row);
    else x.plan.updates.push(row);
  }
}

const NO_REF = {
  contractId: null,
  milestoneId: null,
  contractItemId: null,
  supplierPartyKey: null,
};
const refOf = (m: DeliveryMove) => ({
  contractId: m.contractId ?? null,
  milestoneId: m.milestoneId ?? null,
  contractItemId: m.contractItemId ?? null,
  supplierPartyKey: m.supplierPartyKey ?? null,
});

/** Gói suất quá hạn (hạn < ngày giao) còn suất ⇒ xuất `expire` theo BQ (mỗi gói một dòng). */
function expire(x: Ctx, s: CompState): void {
  for (const l of x.lots.get(s.id) ?? []) {
    if (l.remaining === 0n || l.expiresOn === null || l.expiresOn >= x.on) continue;
    const q = l.remaining;
    const cost = costOut(q, s.onHand, s.value);
    emit(
      x,
      s,
      {
        ...NO_REF,
        lotId: l.id,
        direction: "out",
        reason: "expire",
        qty: fmtQty(q),
        unitCost: n(s.avg),
        amount: n(cost),
      },
      () => {
        x.plan.takes.push({ lotId: l.id, qty: q });
        l.remaining = 0n;
        s.onHand -= q;
        s.value -= cost;
      },
    );
  }
}

function shortages(x: Ctx, ok: readonly Ok[]): StockShortage[] {
  const need = new Map<string, bigint>();
  for (const o of ok)
    if (o.m.direction === "out" && o.c.mode !== "order")
      need.set(o.c.id, (need.get(o.c.id) ?? 0n) + o.qty);
  return [...need]
    .map(([id, q]) => ({ id, q, have: (x.st.get(id) as CompState).onHand }))
    .filter((r) => r.q > r.have)
    .map((r) => ({ componentId: r.id, need: fmtQty(r.q), have: fmtQty(r.have) }));
}

function line(x: Ctx, o: Ok): void {
  const s = x.st.get(o.c.id) as CompState;
  const ref = refOf(o.m);
  const base = {
    ...ref,
    direction: o.m.direction,
    reason: o.m.reason ?? ("delivery" as const),
    qty: fmtQty(o.qty),
  };
  if (s.mode === "order") {
    const price = o.price as bigint;
    emit(
      x,
      s,
      { ...base, lotId: null, unitCost: n(price), amount: n(amountOf(o.qty, price)) },
      () => {},
    );
    return;
  }
  if (o.m.direction === "in") lineIn(x, s, o, base);
  else lineOut(x, s, o, base);
}

type Base = ReturnType<typeof refOf> & {
  direction: "in" | "out";
  reason: "delivery" | "manual";
  qty: string;
};

function lineIn(x: Ctx, s: CompState, o: Ok, base: Base): void {
  {
    const price = o.price as bigint;
    const amount = amountOf(o.qty, price);
    // Tồn đang âm (giao vượt tồn): hàng nhập trước hết bù phần thiếu, chỉ phần dư mới thành lô còn hàng + giá trị tồn.
    const deficit = s.onHand < 0n ? -s.onHand : 0n;
    const keep = o.qty > deficit ? o.qty - deficit : 0n;
    const lot: NewLot = {
      id: x.newId(),
      componentId: s.id,
      qty: o.qty,
      remaining: keep,
      receivedOn: x.on,
      expiresOn: o.m.expiresOn ?? null,
    };
    emit(x, s, { ...base, lotId: lot.id, unitCost: n(price), amount: n(amount) }, () => {
      x.plan.lots.push(lot);
      s.onHand += o.qty;
      s.value += keep > 0n ? amountOf(keep, price) : 0n;
      s.avg = avgOf(s.value, s.onHand, s.avg);
    });
  }
}

function lineOut(x: Ctx, s: CompState, o: Ok, base: Base): void {
  // Xuất: lấy tối đa phần tồn dương; phần vượt (chỉ khi cho phép giao vượt tồn) làm tồn âm, giá vốn theo BQ, không đụng giá trị tồn.
  const avail = s.onHand > 0n ? s.onHand : 0n;
  const take = o.qty < avail ? o.qty : avail;
  const over = o.qty - take;
  const cost = take > 0n ? costOut(take, s.onHand, s.value) : 0n;
  const amount = cost + (over > 0n ? amountOf(over, s.avg) : 0n);
  const mv = { ...base, lotId: null, unitCost: n(s.avg), amount: n(amount) };
  emit(x, s, over > 0n ? { ...mv, overdrawn: fmtQty(over) } : mv, () => {
    if (take > 0n) takeLots(x.lots.get(s.id) ?? [], take, x.plan.takes);
    s.onHand -= o.qty;
    s.value -= cost;
  });
}

const changeOf = (b: CompState, a: CompState): ComponentChange => ({
  componentId: b.id,
  productId: b.productId,
  mode: b.mode,
  onHandBefore: fmtQty(b.onHand),
  onHandAfter: fmtQty(a.onHand),
  valueBefore: n(b.value),
  valueAfter: n(a.value),
  avgCostBefore: n(b.avg),
  avgCostAfter: n(a.avg),
});

/**
 * Kế hoạch một lần giao: kiểm dòng ⇒ hết hạn gói ⇒ chặn vượt tồn (cộng dồn theo thành phần, báo mọi thành phần thiếu) ⇒ nhập/xuất
 * theo thứ tự dòng. `comps` = trạng thái đã khoá; `lots` = lô còn suất/hàng của các thành phần đó. Ném `StockError`.
 */
export function planDelivery(input: {
  on: string;
  moves: readonly DeliveryMove[];
  comps: ReadonlyMap<string, CompState>;
  lots: readonly OpenLot[];
  newId: () => string;
  /** Cài đặt tenant "cho phép giao vượt tồn": thiếu kho không chặn, tồn đi âm (báo `result.overdrawn`). */
  allowNegative?: boolean;
}): DeliveryPlan {
  const ok = checkMoves(input.on, input.moves, input.comps);
  const order = [...new Set(ok.map((o) => o.c.id))];
  const st = new Map(order.map((id) => [id, { ...(input.comps.get(id) as CompState) }]));
  const lots = new Map<string, OpenLot[]>();
  for (const l of input.lots) {
    const s = st.get(l.componentId);
    if (s) lots.set(l.componentId, [...(lots.get(l.componentId) ?? []), { ...l }]);
  }
  for (const [id, ls] of lots) ls.sort(lotOrder((st.get(id) as CompState).mode));
  const x: Ctx = {
    on: input.on,
    newId: input.newId,
    st,
    lots,
    plan: { lots: [], takes: [], moves: [], updates: [], result: { components: [], moves: [] } },
  };
  for (const id of order)
    if ((st.get(id) as CompState).mode === "quota") expire(x, st.get(id) as CompState);
  const short = shortages(x, ok);
  if (short.length && !input.allowNegative)
    throw new StockError("stock_insufficient", "bán vượt tồn", short);
  for (const o of ok) line(x, o);
  const components = order.map((id) =>
    changeOf(input.comps.get(id) as CompState, st.get(id) as CompState),
  );
  x.plan.result = {
    components,
    moves: x.plan.moves,
    ...(short.length ? { overdrawn: short } : {}),
  };
  return x.plan;
}
