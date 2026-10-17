import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, errText, send } from "@/api/client";
import { PREFILL_EVENT, takePrefill } from "@/assistant/prefill";
import { PageHead, Panel, parseMoney, parseQty } from "@/components/ui";

type Item = { name: string; unit: string; qty: string; unit_price: string };
type Form = { direction: "purchase" | "sale"; number: string; title: string; partner_name: string; partner_tax_id: string;
  start_date: string; end_date: string; notice_days: string; total_value: string; payment_terms: string; partner_signer: string; our_signer: string; items: Item[] };
const EMPTY: Form = { direction: "purchase", number: "", title: "", partner_name: "", partner_tax_id: "", start_date: "",
  end_date: "", notice_days: "30", total_value: "", payment_terms: "", partner_signer: "", our_signer: "", items: [{ name: "", unit: "", qty: "", unit_price: "" }] };

/** What the assistant fills in (or a person types): every value as text, the item list as rows. */
function fromPrefill(v: Record<string, unknown>): Form {
  const s = (k: string) => (v[k] == null ? "" : String(v[k]));
  const items = Array.isArray(v.items) ? (v.items as Record<string, unknown>[]).map((i) => ({
    name: String(i.name ?? ""), unit: String(i.unit ?? ""), qty: i.qty == null ? "" : String(i.qty),
    unit_price: i.unit_price == null ? "" : String(i.unit_price) })) : [];
  return { ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).filter((k) => k !== "items" && v[k] != null).map((k) => [k, s(k)])),
    direction: v.direction === "sale" ? "sale" : "purchase", items: items.length ? items : EMPTY.items } as Form;
}

/** Read as typed in Vietnamese ("91.500.000", SL "1,5"); a value that is not a number stops the save with its name. */
function numbers(f: Form): { values: Record<string, number | null>; items: { qty: number | null; unit_price: number | null }[];
  bad: string[] } {
  const bad: string[] = [];
  const check = (label: string, v: number | null) => { if (v !== null && Number.isNaN(v)) bad.push(label); return v; };
  const values = { notice_days: check("Nhắc trước", parseMoney(f.notice_days)), total_value: check("Giá trị", parseMoney(f.total_value)) };
  const items = f.items.filter((i) => i.name.trim()).map((i) => ({
    qty: check(`Số lượng “${i.name}”`, parseQty(i.qty)), unit_price: check(`Đơn giá “${i.name}”`, parseMoney(i.unit_price)) }));
  return { values, items, bad };
}

/** "+ Nhập tay": a contract without a file, saved as confirmed. The assistant can open this page already filled. */
export default function NewContractPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(() => { const v = takePrefill("contract_new"); return v ? fromPrefill(v) : EMPTY; });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {          // already on this page when the assistant fills it again
    const on = () => { const v = takePrefill("contract_new"); if (v) setF(fromPrefill(v)); };
    window.addEventListener(PREFILL_EVENT, on);
    return () => window.removeEventListener(PREFILL_EVENT, on);
  }, []);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });
  const setItem = (i: number, k: keyof Item, v: string) => setF({ ...f, items: f.items.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = numbers(f);
    if (n.bad.length) return setErr(`Không đọc được số ở: ${n.bad.join(", ")}. Gõ kiểu 91.500.000 hoặc 1,5.`);
    setBusy(true);
    setErr(null);
    try {
      const rec = await api<{ id: string }>("/contracts/manual", send({
        direction: f.direction, number: f.number || null, title: f.title, partner_name: f.partner_name,
        partner_tax_id: f.partner_tax_id || null, start_date: f.start_date || null, end_date: f.end_date || null,
        notice_days: n.values.notice_days, total_value: n.values.total_value, payment_terms: f.payment_terms || null, partner_signer: f.partner_signer || null, our_signer: f.our_signer || null,
        items: f.items.filter((i) => i.name.trim()).map((i, j) => ({ name: i.name, unit: i.unit || null, ...n.items[j] })),
      }));
      await qc.invalidateQueries();
      nav(`/contracts/${rec.id}`);
    } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  }

  const field = "field mt-1";
  return (
    <>
      <PageHead crumb={<Link to="/contracts" className="hover:underline">← Hợp đồng</Link>} title="Thêm hợp đồng (nhập tay)"
        lead="Không có file: nhập các thông tin chính. Có file thì dùng “+ Thêm hợp đồng” hoặc kéo file vào trợ lý." />
      <Panel className="p-5">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <label className="text-[13px]">Loại
              <select name="direction" value={f.direction} onChange={set("direction")} className={field}>
                <option value="purchase">Mua vào (mình mua của đối tác)</option><option value="sale">Bán ra (mình bán cho đối tác)</option>
              </select>
            </label>
            <label className="text-[13px]">Số hợp đồng<input name="number" value={f.number} onChange={set("number")} className={field} /></label>
            <label className="col-span-2 text-[13px] max-sm:col-span-1">Tên hợp đồng
              <input name="title" required value={f.title} onChange={set("title")} className={field} placeholder="vd. Cung cấp gạo 2027" /></label>
            <label className="text-[13px]">Đối tác<input name="partner_name" required value={f.partner_name} onChange={set("partner_name")} className={field} /></label>
            <label className="text-[13px]">MST đối tác<input name="partner_tax_id" value={f.partner_tax_id} onChange={set("partner_tax_id")} className={`${field} font-mono`} inputMode="numeric" /></label>
            <label className="text-[13px]">Người ký bên đối tác<input name="partner_signer" value={f.partner_signer} onChange={set("partner_signer")} className={field} placeholder="Nguyễn Văn A – Giám đốc" /></label>
            <label className="text-[13px]">Người ký bên mình<input name="our_signer" value={f.our_signer} onChange={set("our_signer")} className={field} placeholder="Trần Thị B – Giám đốc" /></label>
            <label className="text-[13px]">Hiệu lực từ<input name="start_date" type="date" value={f.start_date} onChange={set("start_date")} className={field} /></label>
            <label className="text-[13px]">Đến<input name="end_date" type="date" value={f.end_date} onChange={set("end_date")} className={field} /></label>
            <label className="text-[13px]">Nhắc trước (ngày)<input name="notice_days" value={f.notice_days} onChange={set("notice_days")} className={`${field} font-mono`} inputMode="numeric" /></label>
            <label className="text-[13px]">Giá trị (đ)<input name="total_value" value={f.total_value} onChange={set("total_value")} className={`${field} font-mono`} inputMode="numeric" /></label>
            <label className="col-span-2 text-[13px] max-sm:col-span-1">Thanh toán
              <textarea name="payment_terms" rows={2} value={f.payment_terms} onChange={set("payment_terms")} className={`${field} h-auto py-2`} /></label>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-semibold">Hàng hoá / dịch vụ</legend>
            {f.items.map((it, i) => (
              <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1.3fr_auto] gap-2 max-sm:grid-cols-2">
                <input aria-label="Tên hàng" placeholder="Tên hàng" value={it.name} onChange={(e) => setItem(i, "name", e.target.value)} className="field" />
                <input aria-label="Đơn vị" placeholder="Đơn vị" value={it.unit} onChange={(e) => setItem(i, "unit", e.target.value)} className="field" />
                <input aria-label="Số lượng" placeholder="SL" value={it.qty} onChange={(e) => setItem(i, "qty", e.target.value)} className="field font-mono" inputMode="decimal" />
                <input aria-label="Đơn giá" placeholder="Đơn giá (đ)" value={it.unit_price} onChange={(e) => setItem(i, "unit_price", e.target.value)} className="field font-mono" inputMode="numeric" />
                <button type="button" aria-label="Bỏ dòng" className="text-dim hover:text-late" onClick={() => setF({ ...f, items: f.items.filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
            <button type="button" className="chip chip-dashed self-start" onClick={() => setF({ ...f, items: [...f.items, { ...EMPTY.items[0] }] })}>+ Thêm dòng hàng</button>
          </fieldset>
          {err && <p role="alert" className="text-sm text-late">{err}</p>}
          <div className="flex justify-end gap-2">
            <Link to="/contracts" className="btn btn-quiet">Huỷ</Link>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Đang lưu…" : "Lưu hợp đồng"}</button>
          </div>
        </form>
      </Panel>
    </>
  );
}
