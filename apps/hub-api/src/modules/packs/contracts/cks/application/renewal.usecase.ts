// HD-FR-94 · BR-2 · BR-7 · BR-8 · D9-09 · D9-18: gia hạn cả nhóm, hoàn tất bằng serial mới, mất khách, hẹn nhắc — port
// `mgmt-app/api/app/cks/sales.py:87-151` + `routes/cks.py:180-243`. Mỗi lệnh MỘT tx: khoá → kiểm → luật → MỘT câu ghi.
import type { PackWho } from "../../../kit/application/ports";
import {
  hasDuplicate,
  nextSaleNumber,
  renewalValidTo,
  saleContract,
  todayIn,
} from "../domain/sale.rules";
import { normSerial } from "../domain/serial.rules";
import type { CksClock, CksUow, RenewalOut } from "./ports";
import { CksFail } from "./read.usecase";

type Deps = { uow: CksUow; clock: CksClock };
export type RenewInput = { price_each: number | null; years: number; remind_at: string | null };

/** "2026-10-21T14:30" | "2026-10-21" (⇒ 09:00) — giờ địa phương của tenant. */
const localAt = (s: string): string => (s.length === 10 ? `${s}T09:00` : s);

export function cksRenewals(d: Deps) {
  const now = async (who: PackWho) => {
    const tz = await d.clock.timeZoneOf(who.tenantId);
    return { tz, today: todayIn(d.clock.now(), tz) };
  };

  const renew = async (who: PackWho, saleId: string, i: RenewInput): Promise<RenewalOut> => {
    const { tz, today } = await now(who);
    return d.uow.tenant(who, async (r) => {
      await r.cks.lock();
      const chk = await r.cks.renewCheck(saleId, today.slice(0, 4));
      const first = chk.certs[0];
      if (chk.open) throw new CksFail("renewal_open");
      if (!first) throw new CksFail("not_found");
      const price = i.price_each ?? first.sale_price ?? 0;
      const earliest = chk.certs.reduce(
        (m, c) => (c.valid_to < m ? c.valid_to : m),
        first.valid_to,
      );
      const validTo = renewalValidTo(today, earliest, i.years);
      const number = nextSaleNumber(today.slice(0, 4), chk.numbers);
      const contract = {
        id: d.clock.newId(),
        ...saleContract({
          number,
          renewal: true,
          customer: chk.buyer ?? "",
          customerTax: chk.buyer_tax,
          ca: first.ca,
          count: chk.certs.length,
          price_each: price,
          signed_at: today,
          valid_to: validTo,
        }),
      };
      const renewal = {
        id: d.clock.newId(),
        sale_contract_id: saleId,
        company_id: first.customer_id,
        certificate_ids: chk.certs.map((c) => c.id),
        new_contract_id: contract.id,
        price_each: price,
        valid_to: validTo,
      };
      await r.cks.insertRenewal({
        renewal,
        contract,
        audit: [
          {
            entity: "renewal",
            entity_id: renewal.id,
            field: "price_each",
            old_value: first.sale_price,
            new_value: price,
          },
        ],
        remindAt: i.remind_at ? { local: localAt(i.remind_at), tz } : null,
      });
      await r.outbox.enqueue([{ entity: "contract", entity_id: contract.id, op: "upsert" }]);
      return { ...renewal, status: "open" as const, lost_reason: null, done_at: null };
    });
  };

  const complete = async (
    who: PackWho,
    id: string,
    i: { serials: Record<string, string>; valid_to: string | null },
  ) => {
    const { today } = await now(who);
    return d.uow.tenant(who, async (r) => {
      await r.cks.lock();
      const rr = await r.cks.renewal(id);
      if (!rr) throw new CksFail("not_found");
      if (rr.status !== "open") throw new CksFail("renewal_closed");
      const news = rr.certificate_ids.map((old) => {
        const serial = i.serials[old]?.trim() || null;
        return { old, id: d.clock.newId(), serial, serial_key: normSerial(serial) };
      });
      const keys = news.map((n) => n.serial_key);
      if (hasDuplicate(keys)) throw new CksFail("serial");
      const live = keys.filter((k): k is string => k !== null);
      if (live.length && (await r.cks.takenSerials(live)).length) throw new CksFail("serial");
      const audit = news.map((n) => ({
        entity: "certificate" as const,
        entity_id: n.id,
        field: "sale_price" as const,
        old_value: rr.old_price,
        new_value: rr.price_each,
      }));
      return r.cks.completeRenewal({ id, today, valid_to: i.valid_to ?? rr.valid_to, news, audit });
    });
  };

  const lose = async (who: PackWho, id: string, reason: string) => {
    const { today } = await now(who);
    return d.uow.tenant(who, async (r) => {
      await r.cks.lock();
      const rr = await r.cks.renewal(id);
      if (rr?.status !== "open") throw new CksFail("not_found"); // G12: như mgmt (KeyError ⇒ 404)
      return r.cks.loseRenewal({ id, reason, today });
    });
  };

  const followup = async (
    who: PackWho,
    customerId: string,
    i: { at: string; note: string | null },
  ) => {
    const { tz } = await now(who);
    return d.uow.tenant(who, async (r) => {
      if (!(await r.cks.customerExists(customerId))) throw new CksFail("not_found");
      return {
        id: await r.cks.insertFollowup({ customer_id: customerId, local: i.at, tz, note: i.note }),
      };
    });
  };
  return { renew, complete, lose, followup };
}
export type CksRenewals = ReturnType<typeof cksRenewals>;
