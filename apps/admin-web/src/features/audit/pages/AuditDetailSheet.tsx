// ADM-FR-51 · ADM-FR-52 · Q8 · M4-AC07 · AC08 · chi tiết một dòng nhật ký: Sheet 640 px ở route con `/audit/$auditId` (plan-frontend D8); nút "Khôi phục bản trước" chỉ khi `restorable`.
import type { AuditItem } from "@ai/contracts";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { Button } from "@/components/ui/button";
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
import { RestoreDialog } from "../components/RestoreDialog";
import { useRestore } from "../hooks/use-restore";
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
          {entry?.restorable ? <RestoreAction item={entry} /> : null}
          {entry ? <AuditDiff entry={entry} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function RestoreAction({ item }: { item: AuditItem }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { restore, pending } = useRestore(item);
  return (
    <div className="mb-4 flex justify-end">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => setOpen(true)}>
        <RotateCcw aria-hidden="true" />
        {t("audit.restore.button")}
      </Button>
      <RestoreDialog item={item} open={open} onOpenChange={setOpen} onConfirm={restore} />
    </div>
  );
}
