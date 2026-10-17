import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errText, send } from "@/api/client";
import { useContractPartner } from "@/api/partners";
import { canWrite, useMe } from "@/api/session";
import PartnerLog from "@/pages/partners/PartnerLog";
import { PREFILL_EVENT, clearPrefill, takePrefill } from "@/assistant/prefill";
import { ErrorLine, Loading, PageHead, Panel, vnd } from "@/components/ui";

type Field = { value: string | number | boolean | null; quote: string; verified: boolean };
type Item = { name: string; unit: string | null; qty: number | null; unit_price: number | null };
type Contract = { id: string; title: string; status: string; fields: Record<string, Field>; items: Item[];
  warnings: { field: string | null; message: string }[]; file?: { name: string; size: number; mime: string } | null };

/** What the review form shows, in reading order; the rest stays reachable through the assistant. */
const SHOWN: [string, string, "text" | "date" | "int"][] = [
  ["number", "Số hợp đồng", "text"], ["title", "Tên hợp đồng", "text"],
  ["supplier_name", "Bên bán", "text"], ["supplier_tax_id", "MST bên bán", "text"],
  ["buyer_name", "Bên mua", "text"], ["buyer_tax_id", "MST bên mua", "text"],
  ["supplier_representative", "Người ký bên bán", "text"], ["buyer_representative", "Người ký bên mua", "text"],
  ["start_date", "Hiệu lực từ", "date"], ["end_date", "Đến", "date"], ["notice_days", "Nhắc trước (ngày)", "int"],
  ["total_value", "Giá trị (đ)", "int"], ["payment_terms", "Thanh toán", "text"],
];

/** Review a contract the extractor read ("Sửa" on the assistant's card): fix fields, then confirm. */
export default function ContractPage() {
  const { id = "" } = useParams();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["contract", id], queryFn: () => api<Contract>(`/contracts/${id}`),
    refetchInterval: (s) => (s.state.data?.status === "extracting" ? 2000 : false) });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "confirm" | null>(null);
  // values the assistant read or corrected (tools import_contract / fix_contract): shown on top of what is stored,
  // kept through refetches, until the person saves
  const [assist, setAssist] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    const grab = () => {
      const v = takePrefill("contract_review", `/contracts/${id}`);
      if (v) setAssist(Object.fromEntries(Object.entries(v).filter(([, x]) => x != null && x !== "").map(([k, x]) => [k, String(x)])));
    };
    grab();
    window.addEventListener(PREFILL_EVENT, grab);
    return () => window.removeEventListener(PREFILL_EVENT, grab);
  }, [id]);

  useEffect(() => {
    if (!q.data) return;
    const stored = Object.fromEntries(SHOWN.map(([k]) => [k, q.data.fields[k]?.value == null ? "" : String(q.data.fields[k].value)]));
    const reading = q.data.status === "extracting";
    setDraft(assist && !reading ? { ...stored, ...assist } : stored);
    if (assist && !reading) clearPrefill("contract_review");
  }, [q.data, assist]);

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorLine error={q.error} />;
  const c = q.data;
  const write = canWrite(me);

  const changed = () => Object.fromEntries(SHOWN.flatMap(([k, , kind]) => {
    const was = c.fields[k]?.value == null ? "" : String(c.fields[k].value);
    if (draft[k] === was) return [];
    const v = draft[k].trim();
    return [[k, v === "" ? null : kind === "int" ? Number(v.replace(/\D/g, "")) : v]];
  }));

  async function save(confirm: boolean) {
    setErr(null);
    setMsg(null);
    // a changed MST is checked with the tax office before the save returns: several seconds, so show it
    setBusy(confirm ? "confirm" : "save");
    try {
      const fields = changed();
      if (Object.keys(fields).length) await api(`/contracts/${id}`, send({ fields }, "PUT"));
      if (confirm) await api(`/contracts/${id}/confirm`, send({}));
      setAssist(null);
      await qc.invalidateQueries();
      setMsg(confirm ? "Đã lưu và xác nhận hợp đồng." : "Đã lưu.");
    } catch (e) { setErr(errText(e)); }
    finally { setBusy(null); }
  }

  return (
    <>
      <PageHead crumb={<Link to="/contracts" className="hover:underline">← Hợp đồng</Link>}
        title={(c.fields.title?.value as string) || c.title}
        lead={c.status === "extracting" ? "Đang đọc hợp đồng…" : c.status === "needs_review" ? "Kiểm tra lại các trường rồi xác nhận." : undefined}
        actions={(c.file || (write && c.status !== "extracting")) && (
          <>
            {c.file && (
              <a href={`/api/contracts/${id}/file`} target="_blank" rel="noreferrer" className="btn btn-outline" title={c.file.name}>
                📄 Xem file gốc
              </a>
            )}
            {write && c.status !== "extracting" && <>
            <button type="button" className={`btn btn-quiet ${assist && c.status !== "needs_review" ? "ring-4 ring-act/40" : ""}`}
              disabled={busy !== null} onClick={() => save(false)}>{busy === "save" ? "Đang lưu…" : "Lưu"}</button>
            {c.status === "needs_review" && <button type="button" className={`btn btn-primary ${assist ? "ring-4 ring-act/40" : ""}`}
              disabled={busy !== null} onClick={() => save(true)}>{busy === "confirm" ? "Đang xác nhận…" : "Xác nhận"}</button>}
            </>}
          </>
        )} />
      {assist && (
        <p className="mb-3 rounded-lg bg-act-soft px-3 py-2 text-[13px] text-act">
          {c.status === "extracting" ? "✦ App đang đọc file; trợ lý sẽ điền những gì nó đọc được ngay khi xong…"
            : `✦ Trợ lý đã điền sẵn ${Object.keys(assist).length} ô — kiểm tra, sửa nếu cần rồi bấm «${c.status === "needs_review" ? "Xác nhận" : "Lưu"}». Chưa có gì được lưu.`}
        </p>
      )}
      {msg && <p role="status" className="mb-3 text-sm text-ok">{msg}</p>}
      {err && <p role="alert" className="mb-3 text-sm text-late">{err}</p>}
      {!!c.warnings.length && (
        <ul className="mb-4 space-y-1 rounded-xl border border-soon-line bg-soon-bg p-4 text-sm text-soon">
          {c.warnings.map((w, i) => <li key={i}>{w.message}</li>)}
        </ul>
      )}
      {c.status === "extract_failed" && (
        <Panel className="mb-4 p-5">
          <p className="font-medium text-late">Không đọc được hợp đồng này.</p>
          <p className="mt-1 text-sm text-dim">AI chưa trích được thông tin từ file (có thể do ảnh mờ, bản quét, hoặc định dạng lạ).
            Bạn có thể xem lại file gốc, xoá rồi tải lên bản rõ hơn, hoặc nhập tay.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {c.file && <a href={`/api/contracts/${id}/file`} target="_blank" rel="noreferrer" className="btn btn-outline" title={c.file.name}>📄 Xem file gốc</a>}
            <Link to="/contracts/new" className="btn btn-primary">Nhập tay</Link>
          </div>
        </Panel>
      )}
      {c.status !== "extract_failed" && (
      <Panel className="mb-4 p-5">
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          {SHOWN.map(([k, label, kind]) => (
            <label key={k} className={`text-[13px] ${k === "payment_terms" || k === "title" ? "col-span-2 max-sm:col-span-1" : ""}`}>
              <span className="flex gap-2">{label}{c.fields[k] && !c.fields[k].verified && c.fields[k].value != null &&
                <span className="text-soon">· chưa kiểm chứng</span>}</span>
              <input className="field mt-1" type={kind === "date" ? "date" : "text"} disabled={!write} value={draft[k] ?? ""}
                onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
              {c.fields[k]?.quote && <span className="mt-1 block text-[12px] text-dim italic">“{c.fields[k].quote}”</span>}
            </label>
          ))}
        </div>
      </Panel>
      )}
      {!!c.items.length && (
        <Panel>
          <table className="w-full text-sm">
            <thead className="bg-sunk text-left text-xs text-dim"><tr><th className="px-4 py-2.5">Hàng hoá</th><th className="px-4">ĐVT</th>
              <th className="px-4 text-right">SL</th><th className="px-4 text-right">Đơn giá</th></tr></thead>
            <tbody>{c.items.map((it, i) => (
              <tr key={i} className="border-t border-rule-soft"><td className="px-4 py-2.5">{it.name}</td><td className="px-4">{it.unit ?? ""}</td>
                <td className="px-4 text-right font-mono">{it.qty ?? ""}</td><td className="px-4 text-right font-mono">{vnd(it.unit_price)}</td></tr>
            ))}</tbody>
          </table>
        </Panel>
      )}
      {!["extracting", "extract_failed", "needs_review"].includes(c.status) && <ContractLog contractId={id} />}
    </>
  );
}

/** "+ Ghi việc" with this contract's partner: its instalments, deliveries, complaints, appointments. */
function ContractLog({ contractId }: { contractId: string }) {
  const p = useContractPartner(contractId);
  const [open, setOpen] = useState(false);
  if (!p.data?.company_id) return null;
  return (
    <Panel className="mt-4 p-5">
      <div className="flex items-center gap-3">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">
          Ghi việc với {p.data.name ?? "đối tác"} <span className="font-normal text-dim">· {p.data.role === "customer" ? "khách hàng" : "nhà cung cấp"}</span>
        </h2>
        <button type="button" className="btn btn-quiet h-9 text-[13px]" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Đóng" : "+ Ghi việc"}
        </button>
      </div>
      {open && <div className="mt-3"><PartnerLog companyId={p.data.company_id} role={p.data.role} contractId={contractId} /></div>}
    </Panel>
  );
}
