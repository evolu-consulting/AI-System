import { dayPlus } from "@/api/followups";
import { useState, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errText } from "@/api/client";
import { completeRenewal, createLot, createSale, type Lot } from "@/api/cks";

const today = () => dayPlus(0);          // the local day (Vietnam), not UTC's: before 07:00 UTC is yesterday
const num = (v: FormDataEntryValue | null) => Number(String(v ?? "").replace(/\D/g, ""));

/** `onDone`: reset what React holds (rows added, dates picked); form.reset() only clears the inputs. */
function useSubmit(ref: RefObject<HTMLDialogElement | null>, run: (f: FormData) => Promise<unknown>, onDone?: () => void) {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setErr(null);
    try {
      await run(new FormData(form));
      await qc.invalidateQueries();
      form.reset();
      onDone?.();
      ref.current?.close();
    } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  }
  return { err, busy, onSubmit };
}

function Actions({ ref, busy, label, disabled }: { ref: RefObject<HTMLDialogElement | null>; busy: boolean; label: string; disabled?: boolean }) {
  return (
    <div className="mt-1 flex justify-end gap-2">
      <button type="button" className="btn btn-quiet" onClick={() => ref.current?.close()}>Huỷ</button>
      <button type="submit" className="btn btn-primary" disabled={busy || disabled}>{busy ? "Đang lưu…" : label}</button>
    </div>
  );
}

/** The CA issued the renewed signatures: their new serials close the renewal and count for the customer's reputation. */
export function CompleteRenewalDialog({ ref, renewalId, certs }: {
  ref: RefObject<HTMLDialogElement | null>; renewalId: string; certs: { id: string; label: string; serial: string | null }[];
}) {
  const s = useSubmit(ref, (f) => completeRenewal(renewalId,
    Object.fromEntries(certs.map((c) => [c.id, String(f.get(c.id) || "")]).filter(([, v]) => v)), String(f.get("valid") || "") || null));
  const [filled, setFilled] = useState(false);     // at least one new serial typed before "Hoàn tất" is allowed
  return (
    <dialog ref={ref} className="sheet">
      <form onSubmit={s.onSubmit} className="flex flex-col gap-3 p-5"
        onInput={(e) => { const f = new FormData(e.currentTarget); setFilled(certs.some((c) => String(f.get(c.id) || "").trim() !== "")); }}>
        <h2 className="text-lg font-semibold">Hoàn tất gia hạn</h2>
        <p className="-mt-1 text-[13px] text-dim">Nhập serial mới của ít nhất một chữ ký để chốt đợt gia hạn.</p>
        {certs.map((c) => (
          <label key={c.id} className="text-[13px]">{c.label} <span className="text-dim">(cũ: {c.serial ?? "—"})</span>
            <input name={c.id} className="field mt-1 font-mono" placeholder="Serial mới" /></label>
        ))}
        <label className="text-[13px]">Hạn mới (để trống: +1 năm)<input name="valid" type="date" className="field mt-1" /></label>
        {s.err && <p role="alert" className="text-sm text-late">{s.err}</p>}
        <Actions ref={ref} busy={s.busy} label="Hoàn tất" disabled={!filled} />
      </form>
    </dialog>
  );
}

/** "+ Nhập lô mua": a purchase contract with the CA, its unpaid balance, and N signatures in stock. */
export function NewLotDialog({ ref }: { ref: RefObject<HTMLDialogElement | null> }) {
  const s = useSubmit(ref, (f) => createLot({
    ca: String(f.get("ca")), supplier_name: String(f.get("supplier") || f.get("ca")), qty: num(f.get("qty")),
    unit_cost: num(f.get("cost")), years: num(f.get("years")) || 1, bought_at: String(f.get("date")),
    label: String(f.get("label") || "") || undefined, device: f.get("device") === "remote" ? "remote" : "token",
  }));
  return (
    <dialog ref={ref} className="sheet">
      <form onSubmit={s.onSubmit} className="flex flex-col gap-3 p-5">
        <h2 className="text-lg font-semibold">Nhập lô mua chữ ký số</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[13px]">Nhà cung cấp (CA)<input name="ca" required className="field mt-1" placeholder="Viettel-CA" /></label>
          <label className="text-[13px]">Tên lô<input name="label" className="field mt-1" placeholder={today().slice(0, 7)} /></label>
          <label className="text-[13px]">Số lượng<input name="qty" required className="field mt-1 font-mono" inputMode="numeric" /></label>
          <label className="text-[13px]">Giá vốn / chữ ký (đ)<input name="cost" required className="field mt-1 font-mono" inputMode="numeric" /></label>
          <label className="text-[13px]">Thời hạn (năm)<input name="years" defaultValue={1} className="field mt-1 font-mono" inputMode="numeric" /></label>
          <label className="text-[13px]">Ngày mua<input name="date" type="date" defaultValue={today()} required className="field mt-1" /></label>
          <label className="col-span-2 text-[13px]">Loại
            <select name="device" className="field mt-1"><option value="token">USB token</option><option value="remote">Ký từ xa</option></select>
          </label>
        </div>
        {s.err && <p role="alert" className="text-sm text-late">{s.err}</p>}
        <Actions ref={ref} busy={s.busy} label="Nhập lô" />
      </form>
    </dialog>
  );
}

/** "+ Hợp đồng bán chữ ký": the sale contract, its receivable, and one signature per holder taken from a lot. */
export function NewSaleDialog({ ref, lots, company }: { ref: RefObject<HTMLDialogElement | null>; lots: Lot[]; company?: string }) {
  const [holders, setHolders] = useState(1);
  // a sale done, the next one starts clean: one holder, today, the auto expiry, the first lot
  const fresh = () => { setHolders(1); setLotId(""); setSigned(today()); setValid(null); };
  const s = useSubmit(ref, (f) => createSale({
    company_name: String(f.get("company")), company_tax_id: String(f.get("tax") || "") || undefined,
    lot_id: String(f.get("lot")), price_each: num(f.get("price")), signed_at: String(f.get("signed")), valid_to: String(f.get("valid")),
    holders: Array.from({ length: holders }, (_, i) => ({
      name: String(f.get(`h${i}`)), title: String(f.get(`t${i}`) || "") || undefined,
      device: (f.get(`d${i}`) === "remote" ? "remote" : "token") as "token" | "remote",
      serial: String(f.get(`s${i}`) || "") || undefined,
    })),
  }), fresh);
  const inStock = lots.filter((l) => l.in_stock > 0);
  // "Hết hạn" follows the signing day and the lot's term until the person types a date of their own
  const [lotId, setLotId] = useState("");
  const [signed, setSigned] = useState(today());
  const [valid, setValid] = useState<string | null>(null);
  const years = (inStock.find((l) => l.id === lotId) ?? inStock[0])?.years ?? 1;
  const later = `${Number(signed.slice(0, 4)) + years}${signed.slice(4)}`;    // same day, `years` later (no timezone maths)
  const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const autoValid = later.endsWith("-02-29") && !leap(Number(later.slice(0, 4))) ? later.replace(/29$/, "28") : later;
  return (
    <dialog ref={ref} className="sheet">
      <form onSubmit={s.onSubmit} className="flex flex-col gap-3 p-5">
        <h2 className="text-lg font-semibold">Hợp đồng bán chữ ký số</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[13px]">Khách hàng<input key={company} name="company" required className="field mt-1" defaultValue={company} /></label>
          <label className="text-[13px]">Mã số thuế<input name="tax" className="field mt-1 font-mono" inputMode="numeric" /></label>
          <label className="col-span-2 text-[13px]">Lấy từ lô
            <select name="lot" required className="field mt-1" value={lotId || inStock[0]?.id || ""} onChange={(e) => setLotId(e.target.value)}>
              {inStock.map((l) => <option key={l.id} value={l.id}>Lô {l.label} · {l.ca} · {l.years ?? 1} năm · còn {l.in_stock}</option>)}
            </select>
          </label>
          <label className="text-[13px]">Giá bán / chữ ký (đ)<input name="price" required className="field mt-1 font-mono" inputMode="numeric" /></label>
          <label className="text-[13px]">Ngày ký<input name="signed" type="date" value={signed} onChange={(e) => setSigned(e.target.value)} required className="field mt-1" /></label>
          <label className="text-[13px]">Hết hạn<input name="valid" type="date" value={valid ?? autoValid} onChange={(e) => setValid(e.target.value)} required className="field mt-1" /></label>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-semibold">Người giữ chữ ký</legend>
          {Array.from({ length: holders }, (_, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 max-sm:grid-cols-2">
              <input name={`h${i}`} required placeholder="Tên (vd: Chữ ký công ty)" className="field" aria-label="Tên người giữ" />
              <input name={`t${i}`} placeholder="Chức danh (vd: Giám đốc)" className="field" aria-label="Chức danh" />
              <input name={`s${i}`} placeholder="Serial (nếu đã có)" className="field font-mono" aria-label="Serial" />
              <select name={`d${i}`} className="field w-auto" aria-label="Thiết bị">
                <option value="token">USB token</option><option value="remote">Ký từ xa</option>
              </select>
            </div>
          ))}
          <button type="button" className="chip chip-dashed self-start" onClick={() => setHolders(holders + 1)}>+ Thêm người giữ</button>
        </fieldset>
        {!inStock.length && <p className="text-sm text-soon">Chưa có lô nào còn hàng: nhập lô mua trước.</p>}
        {s.err && <p role="alert" className="text-sm text-late">{s.err}</p>}
        <Actions ref={ref} busy={s.busy} label="Tạo hợp đồng bán" disabled={!inStock.length} />
      </form>
    </dialog>
  );
}
