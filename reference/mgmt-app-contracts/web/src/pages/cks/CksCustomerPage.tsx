import { useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { renewGroup, uploadSigned, useCksCustomer, useSignedDocs } from "@/api/cks";
import { dayPlus, remindAbout } from "@/api/followups";
import { errText } from "@/api/client";
import { canWrite, useMe } from "@/api/session";
import { Pager, TableTools, useTable } from "@/components/table";
import { Empty, ErrorLine, Loading, PageHead, Panel, vnd, viDate } from "@/components/ui";
import { toast } from "@/components/toast";
import { CompleteRenewalDialog } from "./dialogs";

const KIND = { invoice: "Hóa đơn", tax_return: "Tờ khai", contract: "Hợp đồng", other: "Khác" } as const;
type Kind = keyof typeof KIND;

/** p05 · one customer's signatures: the sale contract, each signature with its holder, and what each one signed. */
export default function CksCustomerPage() {
  const { id = "" } = useParams();
  const { data: me } = useMe();
  const q = useCksCustomer(id);
  const [cert, setCert] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const done = useRef<HTMLDialogElement>(null);
  const [renewing, setRenewing] = useState<string | null>(null);
  /** "Gia hạn cả nhóm" or "Hẹn nhắc" opened under a group: when to remind me (finish the renewal / call the customer). */
  const [ask, setAsk] = useState<{ sale: string; mode: "renew" | "followup"; date: string; time: string; note: string } | null>(null);

  const c = q.data;
  const selected = cert ?? c?.certs[0]?.id ?? undefined;
  const all = useSignedDocs(id, selected);
  const docs = (all.data ?? []).filter((d) => !kind || d.kind === kind);
  const t = useTable(docs, { text: (d) => `${d.number ?? ""} ${d.title} ${KIND[d.kind]} ${d.source}` });
  const count = (k: Kind) => (all.data ?? []).filter((d) => d.kind === k).length;

  if (q.isLoading) return <Loading />;
  if (q.error || !c) return <ErrorLine error={q.error ?? "Không tìm thấy khách"} />;
  const write = canWrite(me);

  async function submitAsk(a: NonNullable<typeof ask>) {
    setErr(null);
    const at = a.time ? `${a.date}T${a.time}` : undefined;
    try {
      if (a.mode === "renew") await renewGroup(a.sale, undefined, at);
      else await remindAbout("company", c!.company_id, `${a.date}T${a.time}`, a.note || undefined);
      setAsk(null);
      await qc.invalidateQueries();
    } catch (e) { setErr(errText(e)); }
  }
  async function upload(files: File[] | null) {   // copied out before the input is cleared for the next pick
    if (!files?.length) return;
    setErr(null);
    try {
      const r = await uploadSigned(files);
      await qc.invalidateQueries({ queryKey: ["signed"] });
      await qc.invalidateQueries({ queryKey: ["cks"] });
      // say what really happened: a file signed by nobody we know, or not a signed XML/PDF, would otherwise look lost
      const matched = r.added - r.unmatched;
      if (matched > 0) toast(`Đã gắn ${matched} văn bản vào chữ ký`);
      const issues = [
        r.unmatched && `${r.unmatched} văn bản không khớp chữ ký nào trong app (đã lưu nhưng chưa gắn với khách nào — kiểm tra serial chữ ký)`,
        r.skipped && `${r.skipped} văn bản đã có từ trước`,
        r.unreadable && `${r.unreadable} file không đọc được chữ ký — chỉ nhận hoá đơn/tờ khai XML hoặc PDF đã ký số`,
      ].filter(Boolean);
      if (issues.length) setErr(issues.join(" · "));
    } catch (e) { setErr(errText(e)); }
  }

  return (
    <>
      <PageHead crumb={<Link to="/cks" className="hover:underline">← Sản phẩm · Chữ ký số</Link>} title={c.name}
        lead={<>{c.cert_count} chữ ký · {c.sales.length} hợp đồng bán ·{" "}
          <Link to={`/partners?company=${encodeURIComponent(c.company_id)}`} className="text-act underline underline-offset-2">Xem hồ sơ đối tác →</Link></>} />
      {err && <p role="alert" className="mb-3 text-sm text-late">{err}</p>}

      {c.sales.map((s) => (
        <Panel key={s.contract_id} className="mb-4">
          <div className="flex flex-wrap items-center gap-3 border-b border-rule bg-sunk px-5 py-4">
            <div className="min-w-0">
              <Link to={`/contracts/${s.contract_id}`} className="text-[17px] font-semibold underline underline-offset-4">Hợp đồng {s.number}</Link>
              <p className="text-[13px] text-dim">Ký {viDate(s.signed_at)} · {s.count} chữ ký × {vnd(s.price_each)} = {vnd(s.total)} đ{s.paid ? " · đã thanh toán" : ""}</p>
            </div>
            {s.valid_to && (() => {
              // this group's own days (the customer's earliest expiry is another group's for a customer with several)
              const left = Math.round((Date.parse(s.valid_to) - Date.parse(dayPlus(0))) / 86_400_000);
              return (
                <span className={`ml-auto text-[13px] font-semibold ${left < 0 ? "text-late" : left <= 30 ? "text-soon" : "text-dim"}`}>
                  {left < 0 ? <>Đã hết hạn {viDate(s.valid_to)}</> : <>Cùng hết hạn {viDate(s.valid_to)} · còn {left} ngày</>}
                </span>
              );
            })()}
            {write && (s.renewal?.status === "open" ? (
              <>
                <span className="tag">Đang gia hạn</span>
                <button type="button" className="btn btn-outline" onClick={() => { setRenewing(s.renewal!.id);
                  setTimeout(() => done.current?.showModal()); }}>Nhập serial mới</button>
              </>
            ) : <button type="button" className="btn btn-primary"
                  onClick={() => setAsk({ sale: s.contract_id, mode: "renew", date: dayPlus(2), time: "09:00", note: "" })}>
                  Gia hạn cả nhóm</button>)}
            <button type="button" className="btn btn-quiet" title="Hệ thống nhắc bạn đúng ngày giờ này"
              onClick={() => setAsk({ sale: s.contract_id, mode: "followup", date: dayPlus(1), time: "09:00", note: "" })}>🔔 Hẹn nhắc</button>
          </div>
          {ask?.sale === s.contract_id && (
            <form className="flex flex-wrap items-end gap-2 border-b border-rule px-5 py-3" onSubmit={(e) => { e.preventDefault(); submitAsk(ask); }}>
              <p className="w-full text-[13px] text-dim">
                {ask.mode === "renew" ? "Mở gia hạn cả nhóm. Khi nào nhắc bạn nhập serial mới để hoàn tất?" : "Nhắc bạn về khách này lúc nào?"}
              </p>
              <label className="flex flex-col text-[12px] text-dim">Ngày
                <input type="date" required value={ask.date} min={dayPlus(0)} onChange={(e) => setAsk({ ...ask, date: e.target.value })}
                  className="field btn-sm h-9 w-auto" />
              </label>
              <label className="flex flex-col text-[12px] text-dim">Lúc
                <input type="time" value={ask.time} required={ask.mode === "followup"} onChange={(e) => setAsk({ ...ask, time: e.target.value })}
                  className="field btn-sm h-9 w-auto" />
              </label>
              {ask.mode === "followup" && (
                <label className="flex flex-col text-[12px] text-dim">Ghi chú
                  <input value={ask.note} maxLength={200} placeholder="vd. gọi chị Hà chào gia hạn" onChange={(e) => setAsk({ ...ask, note: e.target.value })}
                    className="field btn-sm h-9 w-56" />
                </label>
              )}
              <button type="submit" className="btn btn-sm btn-primary">{ask.mode === "renew" ? "Gia hạn" : "Hẹn nhắc"}</button>
              <button type="button" className="h-9 text-[13px] text-dim" onClick={() => setAsk(null)}>Huỷ</button>
            </form>
          )}
          <ul>
            {c.certs.filter((x) => x.sale_contract_id === s.contract_id).map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => setCert(x.id)} aria-pressed={selected === x.id}
                  className={`grid w-full grid-cols-[minmax(0,1.4fr)_1fr_auto] items-center gap-4 border-b border-rule-soft px-5 py-3 text-left last:border-0 ${
                    selected === x.id ? "bg-act-soft" : "hover:bg-sunk"}`}>
                  <span className="min-w-0">
                    <span className="block font-semibold">{x.label}</span>
                    <span className="block font-mono text-[12.5px] text-dim">{x.ca} · {x.device === "token" ? "USB token" : "Ký từ xa"} · {x.serial}</span>
                  </span>
                  <span className="text-[13px] text-dim">{x.device === "token" ? `Giữ: ${x.keeper ?? "—"}` : "Ký qua điện thoại"}</span>
                  <span className="font-mono text-[13px] tnum">{x.signed_count} văn bản</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ))}

      <Panel>
        <div className="flex flex-wrap items-center gap-3 border-b border-rule px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">Văn bản đã ký · {c.certs.find((x) => x.id === selected)?.label ?? ""}
            <span className="ml-1 font-normal text-dim">{all.data?.length ?? 0}</span></h2>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <button type="button" className="chip" aria-pressed={!kind} onClick={() => setKind(null)}>Tất cả</button>
            {(["invoice", "tax_return", "contract"] as Kind[]).map((k) => (
              <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>{KIND[k]} {count(k)}</button>
            ))}
          </div>
        </div>
        <div className="px-5 pt-3.5">
          <TableTools q={t.q} setQ={t.setQ} total={t.total} placeholder="Tìm theo số, tên văn bản…" />
        </div>
        {all.isLoading ? <Loading /> : !all.data?.length ? (
          <Empty title="Chưa có văn bản đã ký">Tải lên hoá đơn, tờ khai hay hợp đồng đã ký (nút bên dưới) để lưu kèm chữ ký số này.</Empty>
        ) : !t.total ? (
          <Empty title="Không có văn bản nào khớp">Thử từ khoá khác.</Empty>
        ) : (
          <ul>
            {t.shown.map((d) => (
              <li key={d.id} className="flex items-center gap-4 border-b border-rule-soft px-5 py-3 last:border-0">
                <span className="min-w-0">
                  <span className="block font-semibold">{d.title}</span>
                  <span className="block text-[13px] text-dim">{KIND[d.kind]} · {d.contract_id ? "có trong tab Hợp đồng" : `tải lên từ file ${d.source.toUpperCase()}`}</span>
                </span>
                <span className="ml-auto font-mono text-[13px] text-dim">{viDate(d.signed_at)}</span>
              </li>
            ))}
          </ul>
        )}
        <Pager t={t} />
        <div className="flex flex-wrap items-center gap-3 px-5 py-3.5 text-[13px] text-dim">
          Chỉ gồm văn bản đã có trong app.
          {write && (
            <>
              <input ref={file} type="file" multiple hidden accept=".xml,.pdf" onChange={(e) => { const fs = e.target.files; void upload(fs ? [...fs] : null); e.target.value = ""; }} />
              <button type="button" className="chip chip-dashed" onClick={() => file.current?.click()}>+ Tải thêm văn bản đã ký</button>
            </>
          )}
        </div>
      </Panel>
      {renewing && (
        <CompleteRenewalDialog ref={done} renewalId={renewing}
          certs={c.certs.filter((x) => c.sales.find((s) => s.renewal?.id === renewing)?.contract_id === x.sale_contract_id)} />
      )}
    </>
  );
}
