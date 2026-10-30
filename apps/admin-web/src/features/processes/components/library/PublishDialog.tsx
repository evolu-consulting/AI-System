// CR-105 · L3 · B1/B5: hộp thoại Xuất bản — hiện tác động (N tenant đang dùng, M lượt đang chạy giữ bản cũ) rồi xác nhận.
// Hub kiểm trước (B2): lỗi 422 `PROCESS_PUBLISH_INVALID` / `SLOT_GROUPS_MISSING` hiện ngay trong hộp, kèm chỗ sai.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess } from "@/components/shared/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/http";
import { processErrorSpec } from "../../lib/errors";
import { errorLines } from "../../lib/library-view";
import { type LibraryDef, publishDef, useImpact, useLibraryRefresh } from "../../library-api";

type Props = { def: LibraryDef; open: boolean; onClose: () => void };
type Failure = { message: string; lines: string[] };

export function PublishDialog({ def, open, onClose }: Props) {
  const { t } = useTranslation();
  const impact = useImpact(def.id, open);
  const refresh = useLibraryRefresh();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [fail, setFail] = useState<Failure | null>(null);
  useEffect(() => {
    if (open) {
      setNote("");
      setFail(null);
    }
  }, [open]);
  const submit = async () => {
    setPending(true);
    setFail(null);
    try {
      const res = await publishDef(def.id, def.version, note);
      notifySuccess(t("process.admin.library.publish.done", { n: res.rel_version }));
      void refresh();
      onClose();
    } catch (err) {
      const s = processErrorSpec(err);
      setFail({
        message: t(s.key, s.params),
        lines: err instanceof ApiError ? errorLines(err.details) : [],
      });
    } finally {
      setPending(false);
    }
  };
  const i = impact.data;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("process.admin.library.publish.title", { name: def.name })}</DialogTitle>
          <DialogDescription>{t("process.admin.library.publish.body")}</DialogDescription>
        </DialogHeader>
        <section
          aria-label={t("process.admin.library.publish.impact")}
          className="space-y-1 rounded-md border border-border p-3"
          data-testid="publish-impact"
        >
          <h3 className="text-label font-semibold">{t("process.admin.library.publish.impact")}</h3>
          {impact.isPending ? (
            <p className="text-body text-muted-foreground">{t("common.loading")}</p>
          ) : impact.isError || !i ? (
            <p role="alert" className="text-body text-destructive">
              {t("process.admin.library.publish.impactFail")}
            </p>
          ) : (
            <>
              <p className="text-body">
                {t("process.admin.library.publish.tenants", { n: i.tenant_count })}
              </p>
              <p className="text-body">
                {t("process.admin.library.publish.runs", { n: i.active_runs })}
              </p>
              {i.is_default ? (
                <p className="text-caption text-muted-foreground">
                  {t("process.admin.library.publish.defaultNote")}
                </p>
              ) : null}
            </>
          )}
        </section>
        <div className="space-y-1.5">
          <Label htmlFor="publish-note">{t("process.admin.library.publish.note")}</Label>
          <Textarea
            id="publish-note"
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {fail ? (
          <div role="alert" className="space-y-1 text-label text-destructive">
            <p>{fail.message}</p>
            {fail.lines.length > 0 ? (
              <ul className="list-disc pl-5 font-mono text-caption">
                {fail.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={pending || impact.isPending}>
            {t("process.admin.library.publish.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
