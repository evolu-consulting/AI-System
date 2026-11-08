// CR-125 · S2 · Cài đặt › "Quy trình duyệt" = MỘT cửa (thay "Ứng dụng & quy trình"): quy trình ĐANG CHẠY của công ty, đọc từ cùng nguồn với trang
// Quy trình ở admin (`company_flows`, "Duyệt 2 cấp"…), chỉ đọc; nút "Mở trang Quy trình" cho quản trị công ty; chưa có quy trình Bật ⇒ nói rõ
// ai làm gì ở đâu (không đẩy sang "quản trị nền tảng"). CR-106: canvas chỉ đọc + công tắc "Sơ đồ | Danh sách". Ký số: `EsignSetting`.
import { toast } from "@ai/web-kit/ui/toast";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "~/features/auth/hooks/use-session";
import { EsignSetting } from "~/features/contract-esign/components/EsignSetting";
import { ReceiveSettings } from "~/features/partner-inbox/components/ReceiveSettings";
import { isCompanyAdmin } from "~/features/shell/lib/nav";
import { ApiError } from "~/lib/api-error";
import { useFlow } from "../hooks/use-flow";
import type { CurrentFlow } from "../lib/current-flow";
import { flowEditorUrl } from "../lib/editor-link";
import { FlowCanvasLazy } from "./FlowCanvasLazy";
import { FlowLegend } from "./FlowLegend";
import { FlowList } from "./FlowList";

type View = "canvas" | "list";

/** CR-106: công tắc "Sơ đồ | Danh sách" (mặc định Sơ đồ = canvas chỉ đọc; Danh sách = `FlowList`). */
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

/** Lối vào trang Quy trình ở admin (SSO một lần) — chỉ quản trị công ty thấy. MỘT nút duy nhất cho việc "đổi quy trình". */
function OpenFlowsPage() {
  const { t } = useTranslation();
  const role = useSession((s) => s.me?.role);
  const [busy, setBusy] = useState(false);
  if (!isCompanyAdmin(role)) return null;
  const go = async () => {
    setBusy(true);
    const url = await flowEditorUrl();
    setBusy(false);
    if (url) window.location.assign(url);
    else toast(t("contracts.flow.current.openFail"), "late");
  };
  return (
    <button
      type="button"
      data-testid="flow-open-page"
      disabled={busy}
      className="btn btn-outline mb-4"
      onClick={() => void go()}
    >
      {t("contracts.flow.current.openPage")}
    </button>
  );
}

/** Khối quy trình đã tải: tiêu đề (tên + bản), ghi chú rẽ nhánh / quy trình khác, sơ đồ (canvas/danh sách). */
function FlowLoaded({ flow }: { flow: CurrentFlow }) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>("canvas");
  const run = flow.steps.map(() => true);
  return (
    <>
      <h2 className="mb-2 text-lg font-semibold" data-testid="flow-current-title">
        {t("contracts.flow.current.title", { name: flow.name, version: flow.version })}
      </h2>
      <p className="mb-3 text-dim" data-testid="flow-readonly-lead">
        {t("contracts.flow.current.lead")}
      </p>
      {flow.hasBranches && (
        <p className="mb-2 text-caption text-dim" data-testid="flow-branches-note">
          {t("contracts.flow.current.branches")}
        </p>
      )}
      {flow.otherFlows > 0 && (
        <p className="mb-2 text-caption text-dim" data-testid="flow-others-note">
          {t("contracts.flow.current.others", { count: flow.otherFlows })}
        </p>
      )}
      <OpenFlowsPage />
      <div>
        <ViewToggle view={view} onChange={setView} />
      </div>
      {view === "canvas" ? (
        <>
          <FlowCanvasLazy steps={flow.steps} run={run} />
          <FlowLegend />
        </>
      ) : (
        <FlowList flow={flow} />
      )}
    </>
  );
}

/** Chưa có quy trình Bật (404) ⇒ nói rõ ai làm gì ở đâu; lỗi khác ⇒ báo + thử lại. KHÔNG che cài đặt khác của mục (ký số). */
function FlowBlock({ q }: { q: ReturnType<typeof useFlow> }) {
  const { t } = useTranslation();
  if (q.error instanceof ApiError && q.error.status === 404)
    return (
      <>
        <p className="mb-3 text-body" data-testid="flow-none">
          {t("contracts.flow.current.noFlow")}
        </p>
        <OpenFlowsPage />
      </>
    );
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
