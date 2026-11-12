// CR-056 · P-a FD2: route quy trình (`/runs/$id`, `/process-inbox`) — engine off ⇒ "Không tìm thấy" (Hub trả 404 cho mọi route khi cờ tắt);
// đang dò ⇒ khung chờ. Chuỗi `processRoute.*` nằm ở bundle chat (không phải `process.*`, vì cờ off thì bundle quy trình không nạp).
import { EmptyState } from "@ai/web-kit/ui/EmptyState";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { useEngineRoute } from "../engine";

export function ProcessNotFound() {
  const { t } = useTranslation();
  return (
    <EmptyState
      full
      kind="off"
      title={t("processRoute.notFound")}
      action={
        <Button asChild variant="outline">
          <Link to="/c/new">{t("thread.backHome")}</Link>
        </Button>
      }
    />
  );
}

export function ProcessRouteGate({ children }: { children: ReactNode }) {
  const state = useEngineRoute();
  if (state === "off") return <ProcessNotFound />;
  if (state === "pending") {
    return (
      <div className="flex flex-1 flex-col gap-3 p-6" aria-busy="true">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  return <>{children}</>;
}
