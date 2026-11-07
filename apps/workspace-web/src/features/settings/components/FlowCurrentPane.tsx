// CR-106: sơ đồ mặc định là canvas chỉ đọc (`FlowCanvasLazy`), công tắc "Sơ đồ | Danh sách".
// CR-105 L4 · mục "Quy trình duyệt" trong Cài đặt: CHỈ ĐỌC. "Quy trình duyệt đang dùng: <tên> · v<N>", sơ đồ bước, xem trước
// đường đi, lối vào ai-admin (chỉ người có quyền). Giữ công tắc ký số (`EsignSetting`, `PUT /approval-settings` ở nơi khác).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EsignSetting } from "~/features/contract-esign/components/EsignSetting";
import { ReceiveSettings } from "~/features/partner-inbox/components/ReceiveSettings";
import { useFlow } from "../hooks/use-flow";
import type { CurrentFlow } from "../lib/current-flow";
import { FlowCanvasLazy } from "./FlowCanvasLazy";
import { FlowEditorLink } from "./FlowEditorLink";
import { FlowLegend } from "./FlowLegend";
import { FlowList } from "./FlowList";
import { FlowPreview, usePreview } from "./FlowPreview";
import { FlowRules } from "./FlowRules";

type View = "canvas" | "list";

/** CR-106: công tắc "Sơ đồ | Danh sách" (mặc định Sơ đồ = canvas chỉ đọc; Danh sách = `Diagram`). */
function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const { t } = useTranslation();
  return (
    <fieldset className="mb-3 inline-flex rounded-lg border border-rule p-0.5">
      <legend className="sr-only">{t("contracts.flow.current.view.label")}</legend>
      {(["canvas", "list"] as const).map((v) => (
        <button
          key={v}
          type="button"
          data-testid={`flow-view-${v}`}
          aria-pressed={view === v}
          className={`rounded-md px-3 py-1 text-label ${
            view === v ? "bg-act-soft font-semibold text-act" : "text-dim"
          }`}
          onClick={() => onChange(v)}
        >
          {t(`contracts.flow.current.view.${v}`)}
        </button>
      ))}
    </fieldset>
  );
}

/** Khối quy trình đã tải: tiêu đề, sơ đồ (canvas/danh sách), lối vào ai-admin, xem trước đường đi. */
function FlowLoaded({ flow }: { flow: CurrentFlow }) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>("canvas");
  const preview = usePreview(flow);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold" data-testid="flow-current-title">
          {t("contracts.flow.current.title", { name: flow.name, version: flow.version })}
        </h2>
        {flow.isDefault && (
          <span
            title={t("contracts.flow.current.defaultHelp")}
            data-testid="flow-default-badge"
            className="rounded-full bg-act-soft px-2.5 py-0.5 text-caption font-semibold text-act"
          >
            {t("contracts.flow.current.defaultBadge")}
          </span>
        )}
      </div>
      {flow.isDefault && (
        <p className="mb-2 text-caption text-dim" data-testid="flow-default-help">
          {t("contracts.flow.current.defaultHelp")}
        </p>
      )}
      <p className="mb-3 text-dim" data-testid="flow-readonly-lead">
        {t("contracts.flow.current.lead")}
      </p>
      <ViewToggle view={view} onChange={setView} />
      {view === "canvas" ? (
        <>
          <FlowCanvasLazy steps={flow.steps} run={preview.run} />
          <FlowLegend />
        </>
      ) : (
        <FlowList flow={flow} />
      )}
      <FlowRules flow={flow} />
      <FlowEditorLink
        testId="flow-editor-link"
        className="mb-4 block text-label text-act underline"
      />
      <FlowPreview flow={flow} p={preview} />
    </>
  );
}

/** Khối quy trình đang dùng; lỗi tải / chưa có bản ⇒ báo tại chỗ, KHÔNG che các cài đặt khác của mục (ký số). */
function FlowBlock({ q }: { q: ReturnType<typeof useFlow> }) {
  const { t } = useTranslation();
  if (q.isError)
    return (
      <p role="alert" className="mb-4 text-late">
        {t("contracts.flow.loadFail")}{" "}
        <button type="button" className="underline" onClick={() => void q.refetch()}>
          {t("contracts.common.retry")}
        </button>
      </p>
    );
  if (!q.data) return <p className="mb-4 text-dim">{t("contracts.common.loading")}</p>;
  return <FlowLoaded flow={q.data} />;
}

export function FlowCurrentPane({ owner }: { owner: boolean }) {
  const q = useFlow(true);
  return (
    <div>
      <FlowBlock q={q} />
      <EsignSetting owner={owner} />
      <ReceiveSettings owner={owner} />
    </div>
  );
}
