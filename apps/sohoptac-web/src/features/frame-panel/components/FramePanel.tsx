// CR-101 DOC-ui-frame · R44 · R45 · R47: khối "Chứng từ con" của HĐ nguyên tắc (full chiều ngang, trên cùng) — giai đoạn, giá trị = Σ con,
// hạn mức + % đã dùng, danh sách con (cảnh báo ngày ngoài hiệu lực — không chặn), gỡ liên kết, menu "Thêm vào diễn biến".
import type { ContractDetail, FrameChild } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { Panel } from "~/components/shared/layout";
import { Tag, type TagTone } from "~/components/shared/tag";
import { useRefreshContract } from "~/features/contract-milestones/hooks/use-milestone-writes";
import { detachFrame } from "../api";
import { docErrorText, outsideCount, usageOf } from "../lib/frame-view";
import { AttachDialog } from "./AttachDialog";

const STAGE_TONE: Record<string, TagTone> = { not_started: "grey", active: "ok", expired: "late" };

function Usage({ doc }: { doc: NonNullable<ContractDetail["doc"]> }) {
  const { t } = useTranslation();
  const u = usageOf(doc.summary, doc.credit_limit);
  return (
    <div className="min-w-[200px] flex-1" data-testid="frame-usage">
      <div className="text-xs text-dim">{t("contracts.docframe.limit")}</div>
      <div className="font-mono text-[15px] font-semibold">
        {doc.credit_limit ? vnd(doc.credit_limit) : t("contracts.docframe.noLimit")}
      </div>
      {u.hasLimit && (
        <>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunk">
            <span
              className={`block h-full ${u.over ? "bg-late" : "bg-act"}`}
              style={{ width: `${u.bar}%` }}
            />
          </div>
          <div className={`mt-1 text-[12.5px] ${u.over ? "text-late" : "text-dim"}`}>
            {t("contracts.docframe.used", { pct: u.pct })}
            {u.over && ` · ${t("contracts.docframe.overLimit")}`}
          </div>
        </>
      )}
    </div>
  );
}

function ChildRow({
  ch,
  write,
  onDetach,
}: {
  ch: FrameChild;
  write: boolean;
  onDetach: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <tr className="border-t border-rule-soft" data-testid="frame-child">
      <td className="px-4 py-2.5 first:pl-5">
        <Link to="/contracts/$id" params={{ id: ch.id }} className="font-medium hover:underline">
          {ch.title}
        </Link>
        {ch.number && <span className="ml-2 text-dim">{ch.number}</span>}
      </td>
      <td className="px-4">
        <Tag tone={ch.doc_type === "deal" ? "soon" : "act"}>
          {t(`contracts.docframe.type.${ch.doc_type}`)}
        </Tag>
      </td>
      <td className="px-4 whitespace-nowrap">
        {ch.start_date ? viDate(ch.start_date) : "—"}
        {ch.outside_frame && (
          <Tag tone="late" className="ml-2" title={t("contracts.docframe.outsideHint")}>
            {t("contracts.docframe.outside")}
          </Tag>
        )}
      </td>
      <td className="px-4 text-right font-mono">{vnd(ch.value)}</td>
      <td className="px-4 text-dim">{t(`contracts.gape.status.${ch.status}`, ch.status)}</td>
      <td className="px-4 text-right last:pr-5">
        {write && (
          <button
            type="button"
            className="text-[12.5px] text-act hover:underline"
            data-testid="frame-detach"
            onClick={() => onDetach(ch.id)}
          >
            {t("contracts.docframe.detach")}
          </button>
        )}
      </td>
    </tr>
  );
}

function AddMenu({ id, onAttach }: { id: string; onAttach: () => void }) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.docframe.${k}`);
  const item = "block w-full px-3 py-2 text-left text-sm hover:bg-sunk";
  return (
    <details className="relative ml-auto" data-testid="frame-add-menu">
      <summary className="btn btn-outline btn-sm cursor-pointer list-none">{L("add")}</summary>
      <div className="absolute right-0 z-10 mt-1 w-64 rounded-lg border border-rule bg-panel py-1 shadow-lg">
        <a className={item} href={`/contracts/new?frame=${id}&type=contract`}>
          {L("addContract")}
        </a>
        <a className={item} href={`/contracts/new?frame=${id}&type=deal`}>
          {L("addDeal")}
        </a>
        <button type="button" className={item} data-testid="frame-attach-open" onClick={onAttach}>
          {L("attachExisting")}
        </button>
      </div>
    </details>
  );
}

export function FramePanel({ c, write }: { c: ContractDetail; write: boolean }) {
  const { t } = useTranslation();
  const refresh = useRefreshContract(c.id);
  const [attach, setAttach] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const doc = c.doc;
  if (!doc || doc.doc_type !== "framework") return null;
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.docframe.${k}`, o);
  const stage = doc.summary?.stage ?? "active";
  const out = outsideCount(doc.children);
  const detach = async (id: string) => {
    setErr(null);
    try {
      await detachFrame(id);
      await refresh();
    } catch (e) {
      setErr(docErrorText(e, t));
    }
  };
  return (
    <Panel className="mb-4">
      <div
        className="flex flex-wrap items-center gap-3 border-b border-rule-soft px-5 py-3.5"
        data-testid="frame-panel"
      >
        <h2 className="text-[15px] font-semibold">{L("children")}</h2>
        <Tag tone={STAGE_TONE[stage] ?? "grey"}>{L(`stage.${stage}`)}</Tag>
        {write && <AddMenu id={c.id} onAttach={() => setAttach(true)} />}
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-3 px-5 py-4">
        <div>
          <div className="text-xs text-dim">{L("value")}</div>
          <div className="font-mono text-[15px] font-semibold" data-testid="frame-value">
            {vnd(doc.summary?.value ?? 0)}
          </div>
        </div>
        <div>
          <div className="text-xs text-dim">{L("count")}</div>
          <div className="font-mono text-[15px] font-semibold" data-testid="frame-count">
            {doc.summary?.children ?? doc.children.length}
          </div>
        </div>
        <Usage doc={doc} />
      </div>
      {out > 0 && (
        <p
          className="mx-5 mb-3 rounded-lg border border-soon-line bg-soon-bg px-3 py-2 text-sm text-soon"
          data-testid="frame-outside-warn"
        >
          {L("outsideWarn", { n: out })}
        </p>
      )}
      {err && (
        <p role="alert" className="px-5 pb-2 text-sm text-late">
          {err}
        </p>
      )}
      {doc.children.length === 0 ? (
        <p className="px-5 pb-4 text-sm text-dim">{L("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {doc.children.map((ch) => (
                <ChildRow key={ch.id} ch={ch} write={write} onDetach={(id) => void detach(id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {attach && (
        <AttachDialog
          frameId={c.id}
          attachedIds={doc.children.map((x) => x.id)}
          onClose={() => setAttach(false)}
          onDone={() => {
            setAttach(false);
            void refresh();
          }}
        />
      )}
    </Panel>
  );
}
