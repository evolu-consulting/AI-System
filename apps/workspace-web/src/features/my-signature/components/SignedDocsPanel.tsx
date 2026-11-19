// CR-188 · BR-188-5 · «Giấy tờ đã ký bằng chữ ký này»: lọc loại + khoảng ngày, mỗi dòng có «Mở». Chỉ giấy tờ người xem có quyền mở (máy chủ lọc).
import type { SigDocItem, SigDocKind } from "@ai/contracts/pack-contracts";
import { DateInput } from "@ai/web-kit/ui/DateInput";
import { Button } from "@ai/web-kit/ui/kit/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ai/web-kit/ui/kit/select";
import { Skeleton } from "@ai/web-kit/ui/kit/skeleton";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { SigDocsFilter } from "../api";

const KINDS: SigDocKind[] = ["contract", "appendix", "other"];

export function SignedDocsPanel(p: {
  filter: SigDocsFilter;
  onFilter: (f: SigDocsFilter) => void;
  items: readonly SigDocItem[];
  loading?: boolean;
  error?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onMore?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const f = p.filter;
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language === "en" ? "en-GB" : "vi-VN");
  return (
    <section className="grid gap-3 rounded-lg border bg-card p-4" data-testid="sig-docs">
      <h2 className="text-base font-semibold">{t("contracts.mySig.docs.title")}</h2>
      <div className="flex flex-wrap items-end gap-3">
        <Select
          value={f.kind || "all"}
          onValueChange={(v) => p.onFilter({ ...f, kind: v === "all" ? "" : (v as SigDocKind) })}
        >
          <SelectTrigger aria-label={t("contracts.mySig.docs.kind")} className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("contracts.mySig.docs.kindAll")}</SelectItem>
            {KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {t(`contracts.mySig.docs.kinds.${k}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateInput
          aria-label={t("contracts.mySig.docs.from")}
          value={f.from}
          max={f.to || undefined}
          onChange={(e) => p.onFilter({ ...f, from: e.target.value })}
          className="w-40"
        />
        <DateInput
          aria-label={t("contracts.mySig.docs.to")}
          value={f.to}
          min={f.from || undefined}
          onChange={(e) => p.onFilter({ ...f, to: e.target.value })}
          className="w-40"
        />
      </div>
      {p.loading && <Skeleton className="h-20 w-full" />}
      {p.error && (
        <p role="alert" className="text-danger">
          {t("contracts.mySig.docs.loadErr")}
        </p>
      )}
      {!p.loading && !p.error && p.items.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="sig-docs-empty">
          {t("contracts.mySig.docs.empty")}
        </p>
      )}
      {p.items.length > 0 && (
        <ul className="grid gap-2">
          {p.items.map((d) => (
            <li
              key={d.version_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
            >
              <div className="grid min-w-0 gap-0.5">
                <span className="truncate text-sm font-medium">{d.title}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {t(`contracts.mySig.docs.kinds.${d.kind}`)} · {day(d.signed_at)}
                  {d.partner ? ` · ${d.partner}` : ""}
                </span>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link to="/contracts/c/$id" params={{ id: d.contract_id }}>
                  {t("contracts.mySig.docs.open")}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {p.hasMore && (
        <div>
          <Button variant="outline" busy={p.loadingMore} onClick={p.onMore}>
            {t("contracts.mySig.docs.more")}
          </Button>
        </div>
      )}
    </section>
  );
}
