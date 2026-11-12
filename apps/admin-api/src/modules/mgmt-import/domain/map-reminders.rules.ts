// mgmt-import · tách từ map-contracts.rules.ts (CR-127 R1 #3): ánh xạ nhắc hạn.
import { type Ctx, docsOf, idOf, type Snapshot } from "./context";
import { type Plan, push, tenantPlan } from "./plan";
import { day, int, isObj, lowerEmail, ts } from "./values.rules";

/** Khoá `remind:{hđ}:{hạn}:{mốc}:{email}` ⇒ phần; hạn không phải ngày (mốc giá `price-…`) ⇒ null. */
export function parseRemindKey(
  id: string,
): { contract: string; deadline: string; milestone: number; email: string } | null {
  if (!id.startsWith("remind:")) return null;
  const parts = id.slice(7).split(":");
  const email = lowerEmail(parts.at(-1));
  const milestone = int(parts.at(-2), -3650, 3650);
  const deadline = day(parts.at(-3));
  if (parts.length < 4 || !email || milestone === null || !deadline) return null;
  return { contract: parts.slice(0, -3).join(":"), deadline, milestone, email };
}

/** `state` remind:* ⇒ contract_reminders (khoá idempotent của HD4: vòng nhắc không gửi lại nhắc đã gửi ở mgmt-app). */
export function mapReminders(
  s: Snapshot,
  ctx: Ctx,
  p: Plan,
  orgOfContract: Map<string, string>,
): void {
  for (const d of docsOf(s, "state")) {
    const k = parseRemindKey(d.id);
    const org = k ? orgOfContract.get(k.contract) : undefined;
    const tid = org ? ctx.tenantOf(org) : null;
    const user = k && tid ? ctx.userOf(tid, k.email) : null;
    if (!k || !org || !tid || !user) continue;
    const v = isObj(d.src.value) ? d.src.value : {};
    push(tenantPlan(p, tid, org), "contracts.contract_reminders", {
      contract_id: idOf(ctx, "contract", k.contract),
      deadline: k.deadline,
      milestone: k.milestone,
      user_id: user,
      channel: "mgmt_import",
      sent_at: ts(v.at),
    });
  }
}
