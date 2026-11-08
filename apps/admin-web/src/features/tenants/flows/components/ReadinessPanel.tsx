// CR-125 · c5b · bảng "mẫu dùng được ở công ty chưa": nói rõ thiếu gì; platform có nút một chạm (bật tính năng / tạo nhóm theo gợi ý).
// Dùng chung cho Gán (platform) và hộp Sao chép (công ty) — MỘT component (Luật GỐC 2).
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { hubConfigured } from "@/lib/hub";
import { useTr } from "@/lib/use-translate";
import {
  canProceed,
  featureParts,
  fixErrorKey,
  ITEM_CODE,
  isBlocking,
  loadErrorKey,
  type ReadinessItem,
  readinessItems,
} from "../lib/readiness-view";
import { useTemplateFix, useTemplateReadiness } from "../readiness-api";

type Props = {
  tenantId: string;
  flowId: string;
  /** true = hộp Sao chép của công ty; false = Gán của platform. */
  copy: boolean;
  isPlatform: boolean;
  /** Báo cho cha: được bấm tiếp (Gán / Sao chép) hay chưa; chưa đọc xong = false. */
  onState: (ok: boolean) => void;
};

function useLabel() {
  const { t } = useTranslation();
  const tr = useTr();
  return (i: ReadinessItem): string => {
    if (i.kind === "group") return t("tenants.companyFlows.readiness.group", { key: i.key });
    const code = ITEM_CODE[i.kind];
    if (i.kind === "feature") {
      const f = featureParts(i.key);
      const app = tr(`featmeta.app.${f.app}.name`);
      const lv = f.level ? tr(`tenants.companyFlows.readiness.level.${f.level}`) : "";
      return t(`tenants.companyFlows.readiness.err.${code}`, {
        stage: i.stage,
        what: `${app} · ${lv}`.replace(/ · $/, ""),
      });
    }
    return t(`tenants.companyFlows.readiness.err.${code}`, { stage: i.stage });
  };
}

/** Không tải được kiểm tra: nói lý do theo mã lỗi + nút thử lại (Gán / Sao chép vẫn khoá, nhưng người dùng biết vì sao). */
function LoadError(p: { error: unknown; retry: () => void }) {
  const { t } = useTranslation();
  const err = p.error ?? (hubConfigured() ? null : { code: "HUB_UNCONFIGURED" });
  return (
    <div className="space-y-2" data-testid="flow-readiness" data-ready="no">
      <p role="alert" className="m-0 text-body text-destructive">
        {t(loadErrorKey(err))}
      </p>
      <Button size="sm" variant="outline" data-testid="readiness-retry" onClick={p.retry}>
        {t("tenants.companyFlows.readiness.retry")}
      </Button>
    </div>
  );
}

export function ReadinessPanel(p: Props) {
  const { t } = useTranslation();
  const label = useLabel();
  const q = useTemplateReadiness(p.tenantId, p.flowId);
  const fix = useTemplateFix(p.tenantId, p.flowId);
  const r = q.data;
  const ok = r ? canProceed(r, p.copy) : false;
  const { onState } = p;
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ báo khi `ok` đổi
  useEffect(() => onState(ok), [ok]);
  if (q.isPending && q.fetchStatus !== "idle")
    return (
      <p className="text-caption text-muted-foreground">
        {t("tenants.companyFlows.readiness.loading")}
      </p>
    );
  if (!r) return <LoadError error={q.error} retry={() => q.refetch()} />;
  const items = readinessItems(r, p.copy);
  const blocked = items.some(isBlocking);
  return (
    <div className="space-y-2" data-testid="flow-readiness" data-ready={ok ? "yes" : "no"}>
      <p className={`m-0 text-body ${ok ? "" : "font-medium"}`}>
        {ok
          ? t(
              items.length
                ? "tenants.companyFlows.readiness.okWarn"
                : "tenants.companyFlows.readiness.ok",
            )
          : t(
              p.isPlatform
                ? "tenants.companyFlows.readiness.blockedPlatform"
                : "tenants.companyFlows.readiness.blockedCompany",
            )}
      </p>
      {items.length > 0 ? (
        <ul className="m-0 list-none space-y-1 p-0">
          {items.map((i) => (
            <li
              key={`${i.kind}-${i.key}-${i.stage}`}
              className="flex flex-wrap items-center gap-2 text-body"
              data-testid={`readiness-${i.kind}`}
            >
              <span className={isBlocking(i) ? "text-destructive" : "text-warning"}>
                {label(i)}
              </span>
              {p.isPlatform && i.fix ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={fix.isPending}
                  data-testid={`readiness-fix-${i.fix}`}
                  onClick={() => i.fix && fix.mutate({ fix: i.fix, key: i.key })}
                >
                  {t(`tenants.companyFlows.readiness.fix.${i.fix}`)}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {fix.isError ? (
        <p role="alert" className="m-0 text-body text-destructive">
          {t(fixErrorKey(fix.error))}
        </p>
      ) : null}
      {blocked && !p.isPlatform ? (
        <p className="m-0 text-caption text-muted-foreground">
          {t("tenants.companyFlows.readiness.askPlatform")}
        </p>
      ) : null}
    </div>
  );
}
