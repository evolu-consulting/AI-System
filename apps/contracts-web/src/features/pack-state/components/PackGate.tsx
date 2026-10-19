// PK-FR-05 · PK-FR-10 · TF4 · cổng gói trong vùng `_authed` (trình bày, không fetch): đang tải ⇒ status "Đang tải…";
// lỗi nạp `/me` ⇒ dòng lỗi + "Thử lại"; chưa bật / không quyền ⇒ trang trạng thái riêng; còn lại ⇒ nội dung (Shell, TF5).
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Loading } from "~/components/shared/states";
import type { PackView } from "../lib/pack-state";
import { PackStatePage } from "./PackStatePage";

type Props = {
  status: "loading" | "error" | "ready";
  view: PackView | null;
  errorKey: string | null;
  onRetry: () => void;
  onLogout: () => void;
  children: ReactNode;
};

export function PackGate({ status, view, errorKey, onRetry, onLogout, children }: Props) {
  const { t } = useTranslation();
  if (status === "loading" || (status === "ready" && !view)) {
    return (
      <main className="grid min-h-dvh place-items-center bg-ground">
        <Loading />
      </main>
    );
  }
  if (status === "error") {
    return (
      <main className="grid min-h-dvh place-items-center bg-ground px-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <p role="alert" className="text-sm text-late">
            {t(errorKey ?? "contracts.errors.unknown")}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-10 items-center rounded-lg bg-act px-4 text-sm font-semibold text-on-act"
          >
            {t("contracts.common.retry")}
          </button>
        </div>
      </main>
    );
  }
  if (view && view.kind !== "ok") return <PackStatePage kind={view.kind} onLogout={onLogout} />;
  return <>{children}</>;
}
