// HUB-FR-66 · Sheet thêm/sửa provider. Sửa: gọi `GET /providers/:id` lấy secret, version (D4) rồi mới dựng form.
import { useTranslation } from "react-i18next";
import { ErrorState } from "#/components/shared/ErrorState";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import { Skeleton } from "#/components/ui/skeleton";
import { useProviderDetail } from "../hooks/use-providers";
import { ProviderForm } from "./ProviderForm";

export type ProviderTarget = { kind: "create" } | { kind: "edit"; id: string; key: string };

function EditLoader({
  id,
  onClose,
  onGuide,
}: {
  id: string;
  onClose: () => void;
  onGuide?: () => void;
}) {
  const q = useProviderDetail(id);
  if (q.error) return <ErrorState onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton aria-busy="true" className="mx-4 h-40" />;
  return (
    <ProviderForm
      key={`${q.data.id}:${q.data.version}`}
      detail={q.data}
      onClose={onClose}
      onGuide={onGuide}
    />
  );
}

export function ProviderSheet({
  target,
  onClose,
  onGuide,
}: {
  target: ProviderTarget | null;
  onClose: () => void;
  onGuide?: () => void;
}) {
  const { t } = useTranslation();
  const title =
    target?.kind === "edit"
      ? t("models.provider.sheet.edit", { key: target.key })
      : t("models.provider.sheet.create");
  return (
    <Sheet open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className="sr-only">{t("models.subtitle")}</SheetDescription>
        </SheetHeader>
        {target?.kind === "edit" ? (
          <EditLoader key={target.id} id={target.id} onClose={onClose} onGuide={onGuide} />
        ) : target ? (
          <ProviderForm detail={null} onClose={onClose} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
