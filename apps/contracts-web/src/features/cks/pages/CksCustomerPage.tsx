// HD-FR-94 · HD-FR-95 · HD-FR-97 · S11 `/cks/$id` — port `CksCustomerPage.tsx:17-196`: nhóm bán, chữ ký, gia hạn (+ hẹn nhắc hoàn
// tất), hẹn nhắc khách (D9-09: HD9 ghi lịch, HD4 gửi), văn bản đã ký + tải thêm, hộp thoại "Hoàn tất gia hạn".
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHead } from "~/components/shared/layout";
import { ErrorLine, Loading } from "~/components/shared/states";
import { toast } from "~/components/shared/toast";
import { useMe } from "~/features/pack-state/hooks/use-me";
import {
  cksKeys,
  completeRenewal,
  fetchCustomer,
  fetchSignedDocs,
  remindAbout,
  renewGroup,
  uploadSigned,
} from "../api";
import { CompleteRenewalDialog } from "../components/CompleteRenewalDialog";
import { type Ask, AskForm, SaleGroupPanel } from "../components/SaleGroupPanel";
import { SignedDocsPanel } from "../components/SignedDocsPanel";
import { cksErrorText, dayPlus, uploadReport } from "../lib/cks";

function useActions(id: string, setErr: (e: string | null) => void) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["cks"] });
  const submitAsk = async (a: Ask, done: () => void) => {
    setErr(null);
    try {
      if (a.mode === "renew") await renewGroup(a.sale, a.time ? `${a.date}T${a.time}` : undefined);
      else await remindAbout(id, `${a.date}T${a.time}`, a.note || undefined);
      done();
      await refresh();
    } catch (e) {
      setErr(cksErrorText(e, t));
    }
  };
  const upload = async (files: File[]) => {
    setErr(null);
    try {
      const r = uploadReport(await uploadSigned(files), t);
      await refresh();
      if (r.toast) toast(r.toast);
      if (r.issues) setErr(r.issues);
    } catch (e) {
      setErr(cksErrorText(e, t));
    }
  };
  return { submitAsk, upload };
}

export function CksCustomerPage() {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cks.customer.${k}`, o);
  const { id } = useParams({ from: "/_authed/cks/$id" });
  const me = useMe();
  const q = useQuery({
    queryKey: cksKeys.customer(id),
    queryFn: ({ signal }) => fetchCustomer(id, signal),
  });
  const [cert, setCert] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [renewing, setRenewing] = useState<string | null>(null);
  const done = useRef<HTMLDialogElement>(null);
  const c = q.data;
  const selected = cert ?? c?.certs[0]?.id ?? undefined;
  const docs = useQuery({
    queryKey: cksKeys.signed(id, selected),
    queryFn: ({ signal }) => fetchSignedDocs(id, selected, signal),
  });
  const act = useActions(id, setErr);
  if (q.isLoading) return <Loading />;
  if (q.error || !c) return <ErrorLine error={q.error ?? L("notFound")} />;
  const group = c.sales.find((s) => s.renewal?.id === renewing);
  return (
    <div className="text-base leading-[1.55]">
      <PageHead
        crumb={
          <Link to="/products" search={{ tab: "cks" }} className="hover:underline">
            {L("back")}
          </Link>
        }
        title={c.name}
        lead={
          <>
            {L("lead", { certs: c.cert_count, sales: c.sales.length })}
            <Link
              to="/partners"
              search={{ company: c.company_id } as never}
              className="text-act underline underline-offset-2"
            >
              {L("partner")}
            </Link>
          </>
        }
      />
      {err && (
        <p role="alert" className="mb-3 text-sm text-late">
          {err}
        </p>
      )}
      {c.sales.map((s) => (
        <SaleGroupPanel
          key={s.contract_id}
          s={s}
          certs={c.certs}
          write={me.write}
          selected={selected}
          select={setCert}
          onAsk={(mode) =>
            setAsk({
              sale: s.contract_id,
              mode,
              date: dayPlus(mode === "renew" ? 2 : 1),
              time: "09:00",
              note: "",
            })
          }
          onComplete={() => {
            setRenewing(s.renewal?.id ?? null);
            setTimeout(() => done.current?.showModal());
          }}
        >
          {ask?.sale === s.contract_id && (
            <AskForm
              ask={ask}
              setAsk={setAsk}
              today={dayPlus(0)}
              submit={(a) => void act.submitAsk(a, () => setAsk(null))}
            />
          )}
        </SaleGroupPanel>
      ))}
      <SignedDocsPanel
        label={c.certs.find((x) => x.id === selected)?.label ?? ""}
        docs={docs.data}
        loading={docs.isLoading}
        write={me.write}
        upload={(fs) => void act.upload(fs)}
      />
      {renewing && (
        <CompleteRenewalDialog
          dlg={done}
          certs={c.certs.filter((x) => group?.contract_id === x.sale_contract_id)}
          complete={(serials, validTo) => completeRenewal(renewing, serials, validTo)}
        />
      )}
    </div>
  );
}
