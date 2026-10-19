// I1 · sổ thanh toán mgmt-app (obligations, partner_events) ⇒ contracts.obligations / partner_events / partner_event_voids.
// Bên = (tên, MST) của công ty để SQL tính `contracts.party_key` (cùng luật HD7). Sự kiện sổ chỉ thêm, id bigint ⇒ khoá idempotent
// `data.mgmt_id`; huỷ (`voided`) ⇒ một hàng huỷ. Nguồn `seed`/`rating`… ngoài tập đích ⇒ `action` (ghi gốc ở data.src). Thuần.
import { type Company, partyOf } from "./companies.rules";
import { type Ctx, idOf, type Snapshot, type SourceDoc } from "./context";
import { eachOrgDoc } from "./each.rules";
import { addMoney, type Plan, push, type TenantPlan } from "./plan";
import { bool, day, int, jsonSafe, lowerEmail, money, str, ts } from "./values.rules";

const EVENT_TYPES = new Set([
  "paid",
  "received",
  "postponed",
  "appointment_kept",
  "appointment_missed",
  "delivered",
  "reminded",
  "complaint",
  "cks_renewed",
  "cks_lapsed",
  "manual_adjust",
  "rating",
  "overdue",
]);
const OB_SOURCES = new Set(["manual", "ai", "default", "cks"]);
const EV_SOURCES = new Set(["action", "assistant", "system"]);
/** Trường riêng theo loại sự kiện (postponed, manual_adjust, rating, cks_renewed, overdue) ⇒ `data`. */
const EXTRAS = [
  "to",
  "was",
  "delta",
  "criterion",
  "value",
  "rated_at",
  "days_before_expiry",
  "with_us",
  "due_date",
  "party_late",
  "kind",
  "seq",
  "certificate_id",
];

function mapObligation(
  d: SourceDoc,
  t: TenantPlan,
  ctx: Ctx,
  companies: Map<string, Company>,
): void {
  const s = d.src;
  const ref = `obligations/${d.id}`;
  const due = day(s.due_date);
  const contract = str(s.contract_id, 128);
  if (!due || !contract || (s.direction !== "pay" && s.direction !== "receive")) {
    ctx.issues.push({ entity: "obligation", ref, code: "OBLIGATION_INCOMPLETE" });
    return;
  }
  const status = ["open", "done", "cancelled"].includes(String(s.status))
    ? String(s.status)
    : "open";
  let doneAt = status === "done" ? day(s.done_at) : null;
  if (status === "done" && !doneAt) {
    ctx.issues.push({ entity: "obligation", ref, code: "DONE_WITHOUT_DATE" });
    doneAt = due;
  }
  const amount = money(s.amount, ctx.issues, "obligation", ref);
  push(t, "contracts.obligations", {
    id: idOf(ctx, "obligation", d.id),
    contract_id: idOf(ctx, "contract", contract),
    ...partyOf(companies, str(s.company_id, 300)),
    direction: s.direction,
    kind: s.kind === "delivery" ? "delivery" : "payment",
    seq: int(s.seq, 1, 9999) ?? 1,
    due_date: due,
    amount,
    status,
    done_at: doneAt,
    done_by: ctx.userOf(t.tenantId, lowerEmail(s.done_by)),
    postponed_to: day(s.postponed_to),
    postpones: int(s.postpones, 0) ?? 0,
    reminders: int(s.reminders, 0) ?? 0,
    overdue_for: day(s.overdue_for),
    source: OB_SOURCES.has(String(s.source)) ? s.source : "manual",
    estimated: bool(s.estimated),
    basis: str(s.basis, 200),
    created_at: ts(s.created_at),
    updated_at: ts(s.updated_at) ?? ts(s.created_at),
  });
  addMoney(t, "obligations.amount", amount);
}

function eventData(d: SourceDoc, ctx: Ctx): Record<string, unknown> {
  const s = d.src;
  const data: Record<string, unknown> = {
    mgmt_id: d.id,
    mgmt_source: ctx.source,
    src: s.source ?? null,
  };
  for (const k of EXTRAS) if (s[k] !== undefined && s[k] !== null) data[k] = s[k];
  const late = typeof s.days_late === "number" && s.days_late < 0 ? s.days_late : undefined;
  if (late !== undefined) data.days_late_raw = late;
  return JSON.stringify(data).length > 4000 ? { mgmt_id: d.id, mgmt_source: ctx.source } : data;
}

function mapEvent(d: SourceDoc, t: TenantPlan, ctx: Ctx, companies: Map<string, Company>): void {
  const s = d.src;
  const ref = `partner_events/${d.id}`;
  const at = day(s.at);
  const party = partyOf(companies, str(s.company_id, 300));
  if (
    !at ||
    !EVENT_TYPES.has(String(s.type)) ||
    (s.role !== "customer" && s.role !== "supplier") ||
    !(party.party_name || party.party_tax)
  ) {
    ctx.issues.push({ entity: "partner_event", ref, code: "EVENT_INCOMPLETE" });
    return;
  }
  const amount = money(s.amount, ctx.issues, "partner_event", ref);
  const by = ctx.userOf(t.tenantId, lowerEmail(s.by));
  const contract = str(s.contract_id, 128);
  const obligation = str(s.obligation_id, 128);
  push(t, "contracts.partner_events", {
    mgmt_id: d.id,
    ...party,
    role: s.role,
    type: s.type,
    at,
    by_user: by,
    source: EV_SOURCES.has(String(s.source)) ? s.source : "action",
    contract_id: contract ? idOf(ctx, "contract", contract) : null,
    obligation_id: obligation ? idOf(ctx, "obligation", obligation) : null,
    days_late: int(s.days_late, 0, 36_500),
    amount,
    note: str(s.note, 500),
    data: jsonSafe(eventData(d, ctx)),
    created_at: ts(s.created_at),
  });
  addMoney(t, "partner_events.amount", amount);
  if (bool(s.voided))
    push(t, "contracts.partner_event_voids", {
      mgmt_id: d.id,
      by_user: ctx.userOf(t.tenantId, lowerEmail(s.voided_by)),
      at: ts(s.voided_at),
    });
}

export function mapLedger(s: Snapshot, ctx: Ctx, p: Plan, companies: Map<string, Company>): void {
  eachOrgDoc(s, ctx, p, "obligations", (d, t) => mapObligation(d, t, ctx, companies));
  eachOrgDoc(s, ctx, p, "partner_events", (d, t) => mapEvent(d, t, ctx, companies));
}
