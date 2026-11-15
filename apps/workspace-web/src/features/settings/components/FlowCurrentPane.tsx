// CR-125 · S2 · Cài đặt › "Quy trình duyệt" = MỘT cửa (thay "Ứng dụng & quy trình"): quy trình ĐANG CHẠY của công ty, đọc từ cùng nguồn với trang
// Quy trình ở admin (`company_flows`, "Duyệt 2 cấp"…), chỉ đọc; nút "Mở trang Quy trình" cho quản trị công ty; chưa có quy trình Bật ⇒ nói rõ
// ai làm gì ở đâu (không đẩy sang "quản trị nền tảng"). CR-106: canvas chỉ đọc + công tắc "Sơ đồ | Danh sách".
import { openInNewTab } from "@ai/web-kit/auth/open-tab";
import { toast } from "@ai/web-kit/ui/toast";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "~/features/auth/hooks/use-session";
import { isCompanyAdmin } from "~/features/shell/lib/nav";
import { useFlow } from "../hooks/use-flow";
import type { CurrentFlow } from "../lib/current-flow";
import { flowEditorUrl } from "../lib/editor-link";
import { whenText } from "../lib/start-when";
import { DelegationPane } from "./DelegationPane";
import { FlowCanvasLazy } from "./FlowCanvasLazy";
import { FlowLegend } from "./FlowLegend";
import { FlowList } from "./FlowList";
import { FlowSignBlock } from "./FlowSignBlock";
import { FlowWorkSettings } from "./FlowWorkSettings";

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
    const ok = await openInNewTab(() => flowEditorUrl());
    setBusy(false);
    if (!ok) toast(t("contracts.flow.current.openFail"), "late");
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

/** Sơ đồ / danh sách bước của MỘT quy trình + khối ký, đối tác (chỉ xem). */
function FlowDetail({ flow }: { flow: CurrentFlow }) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>("canvas");
  const run = flow.steps.map(() => true);
  return (
    <div data-testid="flow-detail">
      <h2 className="mb-2 text-lg font-semibold" data-testid="flow-current-title">
        {t("contracts.flow.current.title", { name: flow.name, version: flow.version })}
      </h2>
      {flow.hasBranches && (
        <p className="mb-2 text-caption text-dim" data-testid="flow-branches-note">
          {t("contracts.flow.current.branches")}
        </p>
      )}
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
      <FlowSignBlock flow={flow} />
    </div>
  );
}

/** CR-146 · danh sách MỌI quy trình đang bật, đúng thứ tự xét; bấm một dòng ⇒ xem sơ đồ của nó. */
function FlowLoaded({ flows }: { flows: CurrentFlow[] }) {
  const { t } = useTranslation();
  const [sel, setSel] = useState(0);
  const cur = flows[Math.min(sel, flows.length - 1)] as CurrentFlow;
  return (
    <>
      <p className="mb-3 text-dim" data-testid="flow-readonly-lead">
        {t("contracts.flow.current.listLead")}
      </p>
      <OpenFlowsPage />
      <ol
        aria-label={t("contracts.flow.current.listLabel")}
        data-testid="flow-list-items"
        className="mb-4 space-y-2"
      >
        {flows.map((f, i) => (
          <li key={f.defId}>
            <button
              type="button"
              data-testid={`flow-item-${i}`}
              aria-pressed={i === sel}
              className={`w-full rounded-lg border p-3 text-left ${
                i === sel ? "border-act bg-act-soft" : "border-rule"
              }`}
              onClick={() => setSel(i)}
            >
              <span className="font-semibold">
                {i + 1}. {f.name}
              </span>
              <span className="ml-2 text-caption text-dim">
                {t("contracts.flow.current.stepCount", { count: f.steps.length })}
              </span>
              <span className="block text-caption text-dim" data-testid={`flow-when-${i}`}>
                {t("contracts.flow.current.startWhen", {
                  when: f.startWhenBad
                    ? t("contracts.flow.current.unreadable")
                    : whenText(f.startWhen, f.groupNames, t),
                })}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <FlowDetail key={cur.defId} flow={cur} />
    </>
  );
}

/** Chưa có quy trình Bật (danh sách rỗng) ⇒ nói rõ ai làm gì ở đâu; lỗi khác ⇒ báo + thử lại. KHÔNG che «Uỷ quyền khi vắng». */
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
  if (q.data.length === 0)
    return (
      <>
        <p className="mb-3 text-body" data-testid="flow-none">
          {t("contracts.flow.current.noFlow")}
        </p>
        <OpenFlowsPage />
      </>
    );
  return <FlowLoaded flows={q.data} />;
}

/** CR-138b · «Quy trình duyệt» chỉ còn danh sách quy trình đang bật (chỉ xem, thứ tự xét + «Bắt đầu khi») + «Uỷ quyền khi vắng»; kết nối ký số / đối tác ở tab «Kết nối». */
export function FlowCurrentPane() {
  const q = useFlow(true);
  return (
    <div>
      <FlowBlock q={q} />
      <FlowWorkSettings />
      <DelegationPane />
    </div>
  );
}
