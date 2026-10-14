// HUB-FR-68 · PC2-R10 · FC2 · sheet "Khoá nguồn": danh sách khoá của tenant + "Tạo khoá" (mở dialog) + thay/xoá từng khoá.
// Lazy-load (chỉ mở theo yêu cầu). Trạng thái: đang tải / rỗng / lỗi + Thử lại. Token không bao giờ hiện lại.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useCredentials } from "../api";
import { CredentialDialog } from "./CredentialDialog";
import { CredentialRow } from "./CredentialRow";

type Props = { tenantId: string | undefined; onClose: () => void };

export default function CredentialSheet({ tenantId, onClose }: Props) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const list = useCredentials(tenantId, true);
  const items = list.data?.items ?? [];

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-[520px]">
        <SheetHeader>
          <SheetTitle>{t("process.sources.credential.manage")}</SheetTitle>
          <SheetDescription className="sr-only">
            {t("process.sources.credential.hint")}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
          <div className="flex justify-end">
            <Button type="button" onClick={() => setCreating(true)} disabled={creating}>
              {t("process.sources.credential.create.action")}
            </Button>
          </div>
          {creating ? (
            <CredentialDialog
              idPrefix="cred-sheet-create"
              tenantId={tenantId}
              onClose={() => setCreating(false)}
              onCreated={() => setCreating(false)}
            />
          ) : null}
          {list.isPending ? (
            <Skeleton aria-busy className="h-20 w-full" />
          ) : list.isError ? (
            <Alert variant="destructive">
              <AlertDescription className="flex items-center justify-between gap-2">
                {t("process.sources.credential.loadError")}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void list.refetch()}
                >
                  {t("process.sources.retry")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-body text-muted-foreground">
              {t("process.sources.credential.empty")}
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((c) => (
                <CredentialRow key={c.id} cred={c} tenantId={tenantId} />
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
