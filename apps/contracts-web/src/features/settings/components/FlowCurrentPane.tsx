// CR-106: sơ đồ mặc định là canvas chỉ đọc (`FlowCanvasLazy`), công tắc "Sơ đồ | Danh sách".
// CR-105 L4 · mục "Quy trình duyệt" trong Cài đặt: CHỈ ĐỌC. "Quy trình duyệt đang dùng: <tên> · v<N>", sơ đồ bước, xem trước
// đường đi, lối vào ai-admin (chỉ người có quyền). Giữ công tắc ký số (`EsignSetting`, `PUT /approval-settings` ở nơi khác).
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EsignSetting } from "~/features/contract-esign/components/EsignSetting";
import { useFlow } from "../hooks/use-flow";
import { type CurrentFlow, type DealKind, previewPath } from "../lib/current-flow";
import { FIELD, Panel } from "./controls";
import { FlowCanvasLazy } from "./FlowCanvasLazy";
import { FlowEditorLink } from "./FlowEditorLink";

type View = "canvas" | "list";

function Diagram({ flow }: { flow: CurrentFlow }) {
  const { t } = useTranslation();
  return (
    <ol className="mb-4 flex flex-col gap-2" data-testid="flow-diagram">
      {flow.steps.map((s, i) => (
        <li key={s.key} className="flex items-center gap-3 rounded-lg border border-rule px-3 py-2">
          <span className="text-caption text-dim">{i + 1}</span>
          <span className="font-medium">{s.name}</span>
          {s.department && s.department !== s.name && (
            <span className="text-caption text-dim">{s.department}</span>
          )}
          {s.kind === "dify" && <span className="text-caption text-dim">Dify</span>}
          {s.kind === "esign" && (
            <span className="text-caption text-dim">{t("contracts.flow.current.esign")}</span>
          )}
          {s.when && s.when.conds.length > 0 && (
            <span className="ml-auto text-caption text-dim">
              {t("contracts.flow.current.conditional")}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/** CR-106: trạng thái "Xem trước đường đi" nâng lên FlowBlock để canvas làm mờ bước bị bỏ qua. */
function usePreview(flow: CurrentFlow) {
  const [deal, setDeal] = useState<DealKind>("buy");
  const [raw, setRaw] = useState("");
  const n = raw.trim() === "" ? null : Number(raw);
  const run = useMemo(
    () => previewPath(flow.steps, { deal, value: n !== null && Number.isFinite(n) ? n : null }),
    [flow.steps, deal, n],
  );
  return { deal, setDeal, raw, setRaw, run };
}

function Preview({
  flow,
  p: { deal, setDeal, raw, setRaw, run },
}: {
  flow: CurrentFlow;
  p: ReturnType<typeof usePreview>;
}) {
  const { t } = useTranslation();
  const f = (k: string) => t(`contracts.flow.${k}`);
  return (
    <Panel title={f("previewTitle")}>
      <div className="flex flex-wrap items-end gap-3 p-4">
        <label className="flex flex-col gap-1">
          <span className="text-caption text-dim">{f("dealKind")}</span>
          <select
            className={`${FIELD} !w-40`}
            value={deal}
            onChange={(e) => setDeal(e.target.value as DealKind)}
          >
            {(["buy", "sell", "referral"] as const).map((d) => (
              <option key={d} value={d}>
                {f(`deal.${d}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-caption text-dim">{f("sampleValue")}</span>
          <input
            type="number"
            min={0}
            className={`${FIELD} !w-48`}
            value={raw}
            placeholder={f("emptyValue")}
            onChange={(e) => setRaw(e.target.value)}
          />
        </label>
      </div>
      <ol className="flex flex-col gap-1 px-4 pb-4" data-testid="flow-preview">
        {flow.steps.map((s, i) => (
          <li key={s.key} data-run={run[i]} className={run[i] ? "" : "text-dim line-through"}>
            {i + 1}. {s.name} — {run[i] ? f("runs") : f("skipped")}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

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
          <span className="rounded-full bg-act-soft px-2.5 py-0.5 text-caption font-semibold text-act">
            {t("contracts.flow.isDefault")}
          </span>
        )}
      </div>
      <p className="mb-3 text-dim">{t("contracts.flow.current.lead")}</p>
      <ViewToggle view={view} onChange={setView} />
      {view === "canvas" ? (
        <FlowCanvasLazy steps={flow.steps} run={preview.run} />
      ) : (
        <Diagram flow={flow} />
      )}
      <FlowEditorLink
        testId="flow-editor-link"
        className="mb-4 block text-label text-act underline"
      />
      <Preview flow={flow} p={preview} />
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
    </div>
  );
}
