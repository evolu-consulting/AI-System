// HUB-FR-131 · HUB-BR-40 · mockup 4 · Dialog kết quả kiểm: tổng (`status`), mục kiểm (lỗi trước, cảnh báo sau; icon + chữ), phiên bản, project.
import type { KhCheckItem, KhCheckResult } from "@ai/contracts/hub-admin";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import type { CheckState } from "../hooks/use-kh-check";

function ItemRow({ item }: { item: KhCheckItem }) {
  const { t, i18n } = useTranslation();
  const key = `knowledgehub.check.code.${item.code}`;
  const text = i18n.exists(key)
    ? t(key, item.params)
    : t("knowledgehub.check.unknown", { code: item.code });
  const err = item.level === "error";
  const Icon = err ? CircleAlert : TriangleAlert;
  return (
    <li className={`flex items-start gap-2 ${err ? "text-danger" : "text-warning"}`}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="sr-only">
        {t(err ? "knowledgehub.check.levelError" : "knowledgehub.check.levelWarning")}:{" "}
      </span>
      <span>{text}</span>
    </li>
  );
}

function Result({ r }: { r: KhCheckResult }) {
  const { t, i18n } = useTranslation();
  const errors = r.items.filter((i) => i.level === "error");
  const sorted = [...errors, ...r.items.filter((i) => i.level !== "error")];
  const at = new Date(r.checked_at);
  return (
    <div className="space-y-3">
      <p role="status" className="font-medium">
        {errors.length === 0
          ? t("knowledgehub.check.ok")
          : t("knowledgehub.check.failed", { n: errors.length })}
      </p>
      {sorted.length > 0 ? (
        <ul className="space-y-1.5 text-body">
          {sorted.map((i) => (
            <ItemRow key={`${i.code}:${Object.values(i.params ?? {}).join(",")}`} item={i} />
          ))}
        </ul>
      ) : null}
      <div className="space-y-1 text-label text-muted-foreground">
        {r.kh_version ? <p>{t("knowledgehub.check.version", { v: r.kh_version })}</p> : null}
        {Number.isNaN(at.getTime()) ? null : (
          <p>{t("knowledgehub.check.at", { time: at.toLocaleString(i18n.language) })}</p>
        )}
        <p>{t("knowledgehub.check.projects", { n: r.projects.length })}</p>
      </div>
      {r.projects.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {r.projects.map((p) => (
            <span key={p} className="rounded-full bg-muted px-2 py-0.5 font-mono text-micro">
              {p}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Failure({ code }: { code: string }) {
  const { t } = useTranslation();
  const text =
    code === "TIMEOUT"
      ? t("knowledgehub.check.timeout")
      : code === "NOT_FOUND"
        ? t("errors.KH_CONNECTION_NOT_FOUND")
        : code === "NETWORK_ERROR"
          ? t("login.err.network")
          : t("login.err.server", { code: code || "UNKNOWN" });
  return (
    <p role="alert" className="text-danger">
      {text}
    </p>
  );
}

export function KhCheckDialog({
  state,
  onClose,
}: {
  state: CheckState | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={state !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("knowledgehub.check.title")}</DialogTitle>
          <DialogDescription>{state?.name ?? t("knowledgehub.check.desc")}</DialogDescription>
        </DialogHeader>
        {state?.phase === "running" ? (
          <p role="status" aria-busy="true">
            {t("knowledgehub.check.running")}
          </p>
        ) : null}
        {state?.phase === "done" ? <Result r={state.result} /> : null}
        {state?.phase === "error" ? <Failure code={state.code} /> : null}
      </DialogContent>
    </Dialog>
  );
}
