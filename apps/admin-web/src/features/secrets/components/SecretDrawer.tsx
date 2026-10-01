// ADM-FR-50 · M2-R04 · drawer 520px: Thêm secret / Thay giá trị / Sửa ghi chú (URL `?drawer=new|replace|note&secret=`).
import type { Secret } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DependencyList } from "@/components/shared/DependencyList";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUpdated } from "@/lib/format";
import type { SecretFormMode, SecretFormValues } from "../lib/schemas";
import { SecretForm, type SecretFormErrors } from "./SecretForm";

type Props = {
  mode: SecretFormMode;
  /** Secret đang sửa (Thay giá trị / Sửa ghi chú). */
  secret?: Secret;
  loading?: boolean;
  notFound?: boolean;
  pending: boolean;
  serverErrors: SecretFormErrors;
  onSubmit: (values: SecretFormValues) => void | Promise<void>;
  onClose: () => void;
};

const FORM_ID = "secret-form";

function ReplaceInfo({ secret }: { secret: Secret }) {
  const { t } = useTranslation();
  const date = formatUpdated(secret.updated_at, null);
  const current = secret.updated_by
    ? t("secrets.replace.current", { last4: secret.last4, date, user: secret.updated_by })
    : t("secrets.replace.currentNoUser", { last4: secret.last4, date });
  return (
    <div className="mb-4 space-y-3">
      <p className="text-body text-muted-foreground">{current}</p>
      <DependencyList
        sections={[
          {
            title: t("secrets.col.usedBy"),
            items: secret.used_by.map((key) => ({
              id: key,
              label: key,
              mono: true,
              href: "/workflows",
              search: { q: key },
            })),
          },
        ]}
      />
    </div>
  );
}

function titleOf(p: Props, t: (k: string, o?: Record<string, string>) => string): string {
  if (p.notFound) return t("state.notFound.title");
  if (p.mode === "create") return t("secrets.drawer.create");
  if (!p.secret) return t("secrets.drawer.replace");
  return p.mode === "replace" ? p.secret.name : t("secrets.note.title", { name: p.secret.name });
}

function Body({ p, onDirty }: { p: Props; onDirty: (d: boolean) => void }) {
  const { t } = useTranslation();
  if (p.notFound)
    return <p className="text-body text-muted-foreground">{t("state.notFound.body")}</p>;
  if (p.loading || (p.mode !== "create" && !p.secret)) return <Skeleton className="h-40 w-full" />;
  return (
    <>
      {p.mode === "replace" && p.secret ? <ReplaceInfo secret={p.secret} /> : null}
      <SecretForm
        formId={FORM_ID}
        mode={p.mode}
        defaultNote={p.secret?.note ?? ""}
        serverErrors={p.serverErrors}
        onDirtyChange={onDirty}
        onSubmit={p.onSubmit}
      />
    </>
  );
}

export function SecretDrawer(p: Props) {
  const { t } = useTranslation();
  const [dirty, setDirty] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);
  const requestClose = () => (dirty ? setAskDiscard(true) : p.onClose());
  const title = titleOf(p, t as never);
  const ready = !p.notFound && !p.loading && (p.mode === "create" || !!p.secret);
  const submitKey = p.mode === "replace" ? "secrets.replace.submit" : "common.save";

  return (
    <>
      <Sheet open onOpenChange={(open) => !open && requestClose()}>
        <SheetContent
          showCloseButton={false}
          onInteractOutside={(e) => e.preventDefault()}
          className="w-full gap-0 sm:max-w-[520px]"
        >
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription className="sr-only">{title}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <Body p={p} onDirty={setDirty} />
          </div>
          <SheetFooter className="flex-row justify-end border-t border-border">
            <Button variant="outline" onClick={requestClose} disabled={p.pending}>
              {t("common.cancel")}
            </Button>
            {ready ? (
              <Button type="submit" form={FORM_ID} disabled={p.pending}>
                {t(submitKey)}
              </Button>
            ) : null}
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={askDiscard}
        onOpenChange={setAskDiscard}
        title={t("unsaved.title")}
        description={t("unsaved.body")}
        cancelLabel={t("unsaved.stay")}
        confirmLabel={t("unsaved.discard")}
        destructive
        onConfirm={p.onClose}
      />
    </>
  );
}
