// ADM-FR-50 · M2-R05 · xoá secret: đang dùng → dialog chặn + DependencyList; không dùng → ConfirmDialog nặng (gõ lại tên).
// 409 `SECRET_IN_USE` (race) chuyển sang dialog chặn với `details.used_by`. Không hiển thị giá trị ở đâu (D10).
import type { Secret } from "@ai/contracts";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { BlockedDialog } from "@/components/shared/BlockedDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DependencyList } from "@/components/shared/DependencyList";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useDeleteSecret } from "../api";

type Target = { name: string; usedBy: string[]; blocked: boolean };

function usedByFrom(details: unknown): string[] {
  const list = (details as { used_by?: unknown } | null | undefined)?.used_by;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
}

export function useSecretDelete() {
  const { t } = useTranslation();
  const tr = useTr();
  const del = useDeleteSecret();
  const [target, setTarget] = useState<Target | null>(null);

  const request = useCallback((s: Secret) => {
    setTarget({ name: s.name, usedBy: s.used_by, blocked: s.used_by.length > 0 });
  }, []);

  const confirm = async () => {
    if (!target) return;
    try {
      await del.mutateAsync(target.name);
      notifySuccess(t("secrets.toast.deleted", { name: target.name }));
    } catch (err) {
      if (err instanceof ApiError && err.code === "SECRET_IN_USE") {
        setTarget({ name: target.name, usedBy: usedByFrom(err.details), blocked: true });
        return;
      }
      if (!(err instanceof ApiError && err.code === "UNAUTHORIZED")) {
        const spec = describeError(err);
        notifyError(tr(spec.key, spec.params));
      }
      throw err; // giữ hộp thoại mở
    }
  };

  const close = () => setTarget(null);
  const name = target?.name ?? "";
  const dialogs = (
    <>
      <BlockedDialog
        open={!!target?.blocked}
        onClose={close}
        title={t("secrets.delete.blocked", { name })}
      >
        <DependencyList
          sections={[
            {
              title: t("common.dependency.workflow"),
              items: (target?.usedBy ?? []).map((key) => ({
                id: key,
                label: key,
                mono: true,
                href: "/workflows",
                search: { q: key },
              })),
            },
          ]}
        />
      </BlockedDialog>
      <ConfirmDialog
        open={!!target && !target.blocked}
        onOpenChange={(open) => !open && close()}
        title={t("secrets.delete.title", { name })}
        confirmLabel={t("secrets.delete.submit")}
        destructive
        level="heavy"
        confirmText={name}
        typePrompt={t("secrets.delete.typeToConfirm", { name })}
        onConfirm={confirm}
      />
    </>
  );
  return { request, dialogs };
}
