// HD-FR-91 · HD-FR-92 · BR-1 · BR-2 · BR-7 · D9-06 · D9-19 · D9-20: nhập lô, bán chữ ký, thêm chữ ký khách tự mua. Mỗi lệnh MỘT tx:
// khoá tenant CKS → MỘT câu kiểm → luật (domain) → MỘT câu ghi (+ outbox HĐ). Lỗi luật ném `CksFail` ⇒ tx hoàn tác.
import type { PackWho } from "../../../kit/application/ports";
import {
  certLabel,
  hasDuplicate,
  lotContract,
  lotLabel,
  nextSaleNumber,
  normTaxId,
  saleContract,
} from "../domain/sale.rules";
import { normSerial } from "../domain/serial.rules";
import type { CertWrite, CksClock, CksUow, Device } from "./ports";
import { CksFail } from "./read.usecase";

export type LotInput = {
  ca: string;
  supplier_name: string | null;
  supplier_tax_id: string | null;
  qty: number;
  unit_cost: number;
  years: number;
  bought_at: string;
  label: string | null;
  device: Device;
};
export type SaleInput = {
  company_name: string;
  company_tax_id: string | null;
  lot_id: string;
  price_each: number;
  signed_at: string;
  valid_to: string;
  holders: {
    name: string;
    title: string | null;
    device: Device;
    serial: string | null;
    keeper: string | null;
  }[];
};
export type CertInput = {
  company_name: string;
  company_tax_id: string | null;
  ca: string;
  serial: string | null;
  valid_to: string;
  holder_name: string;
  device: Device;
};

type Deps = { uow: CksUow; clock: CksClock };
const contractOut = (id: string) => [{ entity: "contract", entity_id: id, op: "upsert" as const }];

const customerOf = (d: Deps, existing: string | null, name: string, tax: string | null) =>
  existing
    ? { id: existing, name, tax_id: tax, isNew: false }
    : { id: d.clock.newId(), name, tax_id: tax, isNew: true };

export function cksSales(d: Deps) {
  const createLot = (who: PackWho, i: LotInput) =>
    d.uow.tenant(who, async (r) => {
      await r.cks.lock();
      const label = lotLabel(i.label, i.bought_at);
      const lot = {
        id: d.clock.newId(),
        label,
        ca: i.ca,
        qty: i.qty,
        unit_cost: i.unit_cost,
        years: i.years,
        device: i.device,
        bought_at: i.bought_at,
      };
      const c = lotContract({
        ...lot,
        supplier_name: i.supplier_name,
        supplier_tax_id: normTaxId(i.supplier_tax_id),
      });
      const contract = { id: d.clock.newId(), ...c };
      await r.cks.insertLot({
        lot,
        contract,
        audit: [
          {
            entity: "lot",
            entity_id: lot.id,
            field: "unit_cost",
            old_value: null,
            new_value: i.unit_cost,
          },
        ],
      });
      await r.outbox.enqueue(contractOut(contract.id));
      return {
        ...lot,
        sold: 0,
        customers: 0,
        in_stock: lot.qty,
        margin: null,
        purchase_contract_id: contract.id,
      };
    });

  const sell = async (who: PackWho, i: SaleInput) => {
    if (i.valid_to <= i.signed_at) throw new CksFail("dates");
    const keys = i.holders.map((h) => normSerial(h.serial));
    if (hasDuplicate(keys)) throw new CksFail("serial");
    const tax = normTaxId(i.company_tax_id);
    const year = i.signed_at.slice(0, 4);
    return d.uow.tenant(who, async (r) => {
      await r.cks.lock();
      const chk = await r.cks.saleCheck({
        lotId: i.lot_id,
        serialKeys: keys.filter((k): k is string => !!k),
        tax,
        name: i.company_name,
        year,
      });
      if (!chk.lot) throw new CksFail("not_found");
      if (chk.lot.sold + i.holders.length > chk.lot.qty) throw new CksFail("stock");
      if (chk.taken.length) throw new CksFail("serial");
      const customer = customerOf(d, chk.customer_id, i.company_name, tax);
      const number = nextSaleNumber(year, chk.numbers);
      const contract = {
        id: d.clock.newId(),
        ...saleContract({
          number,
          renewal: false,
          customer: i.company_name,
          customerTax: tax,
          ca: chk.lot.ca,
          count: i.holders.length,
          price_each: i.price_each,
          signed_at: i.signed_at,
          valid_to: i.valid_to,
        }),
      };
      const certs: CertWrite[] = i.holders.map((h, n) => ({
        id: d.clock.newId(),
        serial: h.serial,
        serial_key: keys[n] ?? null,
        ca: chk.lot?.ca as string,
        device: h.device,
        holder_name: h.name,
        holder_title: h.title,
        keeper: h.keeper,
        valid_from: i.signed_at,
        valid_to: i.valid_to,
        source: "ours",
        lot_id: i.lot_id,
        sale_contract_id: contract.id,
        sale_price: i.price_each,
      }));
      const audit = [
        {
          entity: "sale" as const,
          entity_id: contract.id,
          field: "price_each" as const,
          old_value: null,
          new_value: i.price_each,
        },
      ];
      await r.cks.insertSale({ customer, contract, certs, audit });
      await r.outbox.enqueue(contractOut(contract.id));
      return { contract_id: contract.id, number };
    });
  };

  const addCertificate = (who: PackWho, i: CertInput) => {
    const key = normSerial(i.serial);
    const tax = normTaxId(i.company_tax_id);
    return d.uow.tenant(who, async (r) => {
      await r.cks.lock();
      const chk = await r.cks.saleCheck({
        lotId: null,
        serialKeys: key ? [key] : [],
        tax,
        name: i.company_name,
        year: null,
      });
      if (chk.taken.length) throw new CksFail("serial");
      const customer = customerOf(d, chk.customer_id, i.company_name, tax);
      const cert: CertWrite = {
        id: d.clock.newId(),
        serial: i.serial,
        serial_key: key,
        ca: i.ca,
        device: i.device,
        holder_name: i.holder_name,
        holder_title: null,
        keeper: null,
        valid_from: null,
        valid_to: i.valid_to,
        source: "elsewhere",
        lot_id: null,
        sale_contract_id: null,
        sale_price: null,
      };
      await r.cks.insertSale({ customer, contract: null, certs: [cert], audit: [] });
      const { serial_key: _k, ...out } = cert;
      return {
        ...out,
        company_id: customer.id,
        label: certLabel(cert),
        signed_count: 0,
        status: "active" as const,
      };
    });
  };
  return { createLot, sell, addCertificate };
}
export type CksSales = ReturnType<typeof cksSales>;
