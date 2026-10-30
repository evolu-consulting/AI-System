// CR-105 · L3 · B1: Lịch sử xuất bản + "Quay lại bản này" (Hub tạo bản MỚI bằng nội dung bản cũ, nháp về bản đó).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatUpdated } from "@/lib/format";
import { processErrorSpec } from "../../lib/errors";
import {
  type LibraryDef,
  type ReleaseItem,
  rollbackDef,
  useLibraryRefresh,
  useReleases,
} from "../../library-api";

type Props = { def: LibraryDef; open: boolean; onClose: () => void };

export function ReleasesDialog({ def, open, onClose }: Props) {
  const { t } = useTranslation();
  const q = useReleases(def.id, open);
  const refresh = useLibraryRefresh();
  const [target, setTarget] = useState<ReleaseItem | null>(null);
  const rows = [...(q.data ?? [])].sort((a, b) => b.rel_version - a.rel_version);
  const confirm = async () => {
    if (!target) return;
    try {
      const res = await rollbackDef(def.id, target.rel_version);
      notifySuccess(
        t("process.admin.library.releases.done", { from: target.rel_version, to: res.rel_version }),
      );
      void refresh();
      setTarget(null);
      onClose();
    } catch (err) {
      const s = processErrorSpec(err);
      notifyError(t(s.key, s.params));
      throw err;
    }
  };
  return (
    <>
      <Dialog open={open && target === null} onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("process.admin.library.releases.title", { name: def.name })}
            </DialogTitle>
            <DialogDescription>{t("process.admin.library.releases.body")}</DialogDescription>
          </DialogHeader>
          {q.isPending ? (
            <p className="text-body text-muted-foreground">{t("common.loading")}</p>
          ) : null}
          {q.isError ? (
            <p role="alert" className="text-body text-destructive">
              {t("process.admin.library.releases.fail")}
            </p>
          ) : null}
          {q.data && rows.length === 0 ? (
            <p className="text-body text-muted-foreground">
              {t("process.admin.library.releases.empty")}
            </p>
          ) : null}
          <ul className="max-h-80 space-y-2 overflow-y-auto" data-testid="release-list">
            {rows.map((r, i) => (
              <li
                key={r.rel_version}
                className="flex items-center gap-3 rounded-md border border-border p-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-label font-medium">
                    v{r.rel_version}
                    {i === 0 ? ` · ${t("process.admin.library.releases.latest")}` : ""}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {formatUpdated(r.published_at, r.published_by)}
                  </p>
                  {r.note ? <p className="truncate text-caption">{r.note}</p> : null}
                </div>
                {i === 0 ? null : (
                  <Button size="sm" variant="outline" onClick={() => setTarget(r)}>
                    {t("process.admin.library.releases.rollback")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title={t("process.admin.library.releases.confirmTitle", { n: target?.rel_version ?? 0 })}
        description={t("process.admin.library.releases.confirmBody", {
          n: target?.rel_version ?? 0,
        })}
        confirmLabel={t("process.admin.library.releases.rollback")}
        onConfirm={confirm}
      />
    </>
  );
}
