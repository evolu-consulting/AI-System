// HUB-FR-68 · PC2-R10 · FC2 · một khoá nguồn trong sheet: tên + "Đã đặt", thay token (ô "Token mới" + "Lưu"), xoá khoá.
// Khoá đang dùng (used_by nguồn > 0) ⇒ "Xoá khoá" tắt + câu `credential.inUse` (luật used_by H4b-1). Token KHÔNG vào log/URL.
import type { HubSecret } from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FormField } from "@/components/shared/form/FormField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCredentialRow } from "../hooks/use-credential-row";
import { sourceUsedByCount } from "../lib/errors";

type Props = { cred: HubSecret; tenantId: string | undefined };

export function CredentialRow({ cred, tenantId }: Props) {
  const { t } = useTranslation();
  const r = useCredentialRow(cred, tenantId);
  const { token, setToken, rotating, setRotating, err } = r;
  const [delOpen, setDelOpen] = useState(false);
  const used = sourceUsedByCount(cred.used_by);
  const usedKeys = cred.used_by.filter((u) => u.type === "source").map((u) => u.key);

  return (
    <li className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-body">{cred.name}</span>
        <Badge variant="info">{t("process.sources.credential.set")}</Badge>
      </div>
      {used > 0 ? (
        <>
          <p className="text-caption text-muted-foreground">
            {t("process.sources.credential.usedBy")}:{" "}
            <span className="font-mono">{usedKeys.join(" · ")}</span>
          </p>
          <p role="status" className="text-caption text-warning">
            {t("process.sources.credential.inUse", { n: used })}
          </p>
        </>
      ) : null}
      {rotating ? (
        <form onSubmit={r.submitRotate} noValidate className="space-y-2">
          <FormField
            id={`cred-rotate-${cred.id}`}
            label={t("process.sources.credential.rotate.token")}
            error={err}
            alert
          >
            {(p) => (
              <Input
                {...p}
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t("process.sources.credential.rotate.token.ph")}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
            )}
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={r.cancelRotate}>
              {t("process.sources.credential.cancel")}
            </Button>
            <Button type="submit" disabled={token === "" || r.isPending}>
              {t("process.sources.credential.rotate.save")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setRotating(true)}>
            {t("process.sources.credential.rotate.action")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={used > 0}
            onClick={() => setDelOpen(true)}
          >
            {t("process.sources.credential.delete")}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={delOpen}
        onOpenChange={setDelOpen}
        title={t("process.sources.credential.delete.title", { name: cred.name })}
        description={t("process.sources.credential.delete.body")}
        confirmLabel={t("process.sources.credential.delete")}
        destructive
        onConfirm={r.confirmDelete}
      />
    </li>
  );
}
