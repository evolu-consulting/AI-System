// HD-FR-95 · S11 · "Văn bản đã ký" của chữ ký đang chọn: chip loại có số đếm, tìm, danh sách, tải thêm — port
// `CksCustomerPage.tsx:148-189`.
import type { CksSignedDoc } from "@ai/contracts";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import { Panel } from "~/components/shared/layout";
import { Empty, Loading } from "~/components/shared/states";
import { Pager, TableTools, useTable } from "~/features/table";

type Kind = CksSignedDoc["kind"];
const KINDS: Kind[] = ["invoice", "tax_return", "contract"];

type Props = {
  label: string;
  docs: CksSignedDoc[] | undefined;
  loading: boolean;
  write: boolean;
  upload: (files: File[]) => void;
};

export function SignedDocsPanel({ label, docs, loading, write, upload }: Props) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cks.customer.${k}`, o);
  const K = (k: Kind) => t(`contracts.cks.kind.${k}`);
  const [kind, setKind] = useState<Kind | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const shown = (docs ?? []).filter((d) => !kind || d.kind === kind);
  const tb = useTable(shown, {
    text: (d) => `${d.number ?? ""} ${d.title} ${K(d.kind)} ${d.source}`,
  });
  const count = (k: Kind) => (docs ?? []).filter((d) => d.kind === k).length;
  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-3 border-b border-rule px-5 py-3.5">
        <h2 className="text-[15px] font-semibold">
          {L("signedTitle", { label })}
          <span className="ml-1 font-normal text-dim">{docs?.length ?? 0}</span>
        </h2>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <button type="button" className="chip" aria-pressed={!kind} onClick={() => setKind(null)}>
            {t("contracts.cks.filter.all")}
          </button>
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className="chip"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
            >
              {K(k)} {count(k)}
            </button>
          ))}
        </div>
      </div>
      <div className="px-5 pt-3.5">
        <TableTools q={tb.q} setQ={tb.setQ} total={tb.total} placeholder={L("searchDocs")} />
      </div>
      {loading ? (
        <Loading />
      ) : !docs?.length ? (
        <Empty title={L("noDocsTitle")}>{L("noDocsBody")}</Empty>
      ) : !tb.total ? (
        <Empty title={L("noDocMatch")}>{t("contracts.cks.noMatchBody")}</Empty>
      ) : (
        <ul>
          {tb.shown.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-4 border-b border-rule-soft px-5 py-3 last:border-0"
            >
              <span className="min-w-0">
                <span className="block font-semibold">{d.title}</span>
                <span className="block text-[13px] text-dim">
                  {K(d.kind)} ·{" "}
                  {d.contract_id
                    ? L("inContracts")
                    : L("fromFile", { source: d.source.toUpperCase() })}
                </span>
              </span>
              <span className="ml-auto font-mono text-[13px] text-dim">{viDate(d.signed_at)}</span>
            </li>
          ))}
        </ul>
      )}
      <Pager t={tb} />
      <div className="flex flex-wrap items-center gap-3 px-5 py-3.5 text-[13px] text-dim">
        {L("onlyInApp")}
        {write && (
          <>
            <input
              ref={file}
              type="file"
              multiple
              hidden
              accept=".xml,.pdf"
              onChange={(e) => {
                const fs = e.target.files;
                if (fs?.length) upload([...fs]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="chip chip-dashed"
              onClick={() => file.current?.click()}
            >
              {L("upload")}
            </button>
          </>
        )}
      </div>
    </Panel>
  );
}
