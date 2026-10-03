// ADM-FR-51 · Q8 · M4-AC07 · chi tiết một dòng nhật ký: Sheet 640 px ở route con `/audit/$auditId` (plan-frontend D8). Nút Khôi phục thuộc FE4b.
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/shared/states/ErrorState";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { auditSentence } from "@/lib/audit-sentence";
import { ApiError } from "@/lib/http";
import { loadError } from "@/lib/load-error";
import { useTr } from "@/lib/use-translate";
import { useAuditEntry } from "../api";
import { AuditDiff } from "../components/AuditDiff";
import { auditMeta } from "../lib/meta";

const route = getRouteApi("/_authed/audit/$auditId");

export function AuditDetailSheet() {
  const { t } = useTranslation();
  const tr = useTr();
  const { auditId } = route.useParams();
  const search = route.useSearch();
  const navigate = useNavigate();
  const q = useAuditEntry(auditId);
  const close = (open: boolean) => {
    if (!open) void navigate({ to: "/audit", search, replace: true });
  };
  const entry = q.data;
  const missing = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403);
  const err = q.isError && !missing ? loadError(q.error) : null;
  const title = entry
    ? auditSentence(entry, tr)
    : missing
      ? t("state.notFound.title")
      : t("audit.title");
  return (
    <Sheet open onOpenChange={close}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-[640px]">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {entry ? auditMeta(entry, tr) : missing ? t("state.notFound.body") : null}
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          {q.isPending ? <Skeleton className="h-40 w-full" /> : null}
          {err ? <ErrorState {...err} onRetry={() => void q.refetch()} /> : null}
          {entry ? <AuditDiff entry={entry} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
