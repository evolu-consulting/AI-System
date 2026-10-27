// trello-config-ui · khối "Tích hợp › Trello" (chỉ platform_admin) trên trang Góp ý: nhập API key/token (ô mật khẩu, để trống =
// giữ nguyên), list id; "Kiểm tra kết nối" chỉ đọc list (không tạo thẻ); "Xoá cấu hình" ⇒ dùng lại env. Không bao giờ hiện giá trị.
import { TRELLO_LIST_ID_RE, type TrelloConfigView } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/http";
import { useCheckTrello, useClearTrello, useSaveTrello, useTrelloConfig } from "../api";

const SOURCE_TONE = { db: "ok", env: "info", none: "warn" } as const;

function SecretHint({ s }: { s: TrelloConfigView["api_key"] }) {
  const { t } = useTranslation();
  return (
    <span className="text-label text-muted-foreground">
      {s.set
        ? t("feedbackAdmin.trello.savedEnding", { last4: s.last4 ?? "" })
        : t("feedbackAdmin.trello.notSet")}
    </span>
  );
}

/** `enabled` = người xem là platform_admin; khác ⇒ không gọi API, không hiện gì. */
export function TrelloConfigCard({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const cfg = useTrelloConfig(enabled);
  const save = useSaveTrello();
  const clear = useClearTrello();
  const check = useCheckTrello();
  const [apiKey, setApiKey] = useState("");
  const [token, setToken] = useState("");
  const [listId, setListId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const v = cfg.data;
  const list = listId ?? v?.list_id ?? "";
  const first = !v?.api_key.set;
  const valid = TRELLO_LIST_ID_RE.test(list.trim()) && (!first || (apiKey.trim() && token.trim()));

  const onSave = async () => {
    try {
      await save.mutateAsync({
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        ...(token.trim() ? { token: token.trim() } : {}),
        list_id: list.trim(),
      });
      setApiKey("");
      setToken("");
      setListId(null);
      notifySuccess(t("feedbackAdmin.trello.saved"));
    } catch (e) {
      notifyError(e instanceof ApiError ? e.message : t("feedbackAdmin.trello.saveFailed"));
    }
  };
  const onCheck = async () => {
    const r = await check.mutateAsync().catch(() => null);
    if (r?.ok) notifySuccess(t("feedbackAdmin.trello.checkOk", { name: r.list_name ?? "" }));
    else notifyError(t(`feedbackAdmin.trello.checkErr.${r?.error ?? "network"}`));
  };

  if (!enabled || !v) return null;
  return (
    <section
      aria-label={t("feedbackAdmin.trello.title")}
      className="mb-6 space-y-3 rounded-lg border border-border p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-body font-semibold">{t("feedbackAdmin.trello.title")}</h2>
        <Badge variant={SOURCE_TONE[v.source]}>
          {t(`feedbackAdmin.trello.source.${v.source}`)}
        </Badge>
      </div>
      <p className="text-label text-muted-foreground">{t("feedbackAdmin.trello.hint")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="trello-key">{t("feedbackAdmin.trello.apiKey")}</Label>
          <Input
            id="trello-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            placeholder={v.api_key.set ? t("feedbackAdmin.trello.keep") : ""}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <SecretHint s={v.api_key} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="trello-token">{t("feedbackAdmin.trello.token")}</Label>
          <Input
            id="trello-token"
            type="password"
            autoComplete="off"
            value={token}
            placeholder={v.token.set ? t("feedbackAdmin.trello.keep") : ""}
            onChange={(e) => setToken(e.target.value)}
          />
          <SecretHint s={v.token} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="trello-list">{t("feedbackAdmin.trello.listId")}</Label>
          <Input id="trello-list" value={list} onChange={(e) => setListId(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!valid || save.isPending} onClick={() => void onSave()}>
          {t("feedbackAdmin.trello.save")}
        </Button>
        <Button
          variant="outline"
          disabled={v.source === "none" || check.isPending}
          onClick={() => void onCheck()}
        >
          {t("feedbackAdmin.trello.check")}
        </Button>
        {v.source === "db" ? (
          <Button variant="outline" onClick={() => setConfirm(true)}>
            {t("feedbackAdmin.trello.clear")}
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("feedbackAdmin.trello.clearTitle")}
        description={t(
          v.env_configured ? "feedbackAdmin.trello.clearToEnv" : "feedbackAdmin.trello.clearToNone",
        )}
        confirmLabel={t("feedbackAdmin.trello.clear")}
        destructive
        onConfirm={async () => {
          await clear.mutateAsync();
          setListId(null);
          notifySuccess(t("feedbackAdmin.trello.cleared"));
        }}
      />
    </section>
  );
}
