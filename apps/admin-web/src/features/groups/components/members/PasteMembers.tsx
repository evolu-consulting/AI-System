// ADM-FR-62 · M3-R03 · D12 · khối "Thêm nhiều người": dán username (mỗi dòng một người), đếm, xem trước dry_run, nút `Thêm {count} người`.
import type { GroupMembersAddResponse } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/form/FormField";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  text: string;
  onText: (v: string) => void;
  count: number;
  tooMany: boolean;
  preview: GroupMembersAddResponse | null;
  checking: boolean;
  pending: boolean;
  onSubmit: () => void;
};

type StatusProps = Pick<Props, "preview" | "checking" | "count" | "tooMany">;

function PasteStatus({ preview, checking, count, tooMany }: StatusProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1 text-caption">
      {count > 0 ? (
        <p className="text-muted-foreground">{t("groups.paste.count", { count })}</p>
      ) : null}
      {tooMany ? (
        <p role="alert" className="text-destructive">
          {t("groups.paste.tooMany", { count })}
        </p>
      ) : null}
      {checking ? <p className="text-muted-foreground">{t("groups.paste.checking")}</p> : null}
      {preview && preview.not_found.length > 0 ? (
        <p role="status" className="text-destructive">
          {t("groups.paste.notFound", { names: preview.not_found.join(", ") })}
        </p>
      ) : null}
      {preview && preview.already.length > 0 ? (
        <p className="text-muted-foreground">
          {t("groups.paste.already", { count: preview.already.length })}
        </p>
      ) : null}
    </div>
  );
}

export function PasteMembers(p: Props) {
  const { t } = useTranslation();
  return (
    <div className="max-w-xl space-y-2">
      <FormField id="paste-members" label={t("groups.paste.label")}>
        {(f) => (
          <Textarea
            {...f}
            aria-label={t("groups.paste.aria")}
            rows={4}
            spellCheck={false}
            className="font-mono"
            value={p.text}
            onChange={(e) => p.onText(e.target.value)}
          />
        )}
      </FormField>
      <PasteStatus preview={p.preview} checking={p.checking} count={p.count} tooMany={p.tooMany} />
      <Button type="button" disabled={p.count === 0 || p.tooMany || p.pending} onClick={p.onSubmit}>
        {t("groups.paste.submit", { count: p.count })}
      </Button>
    </div>
  );
}
