// ADM-FR-42 · M4-R07, R08 · "Top feature theo số thu" (5 dòng) và "Top user theo số thu": "Không theo feature", badge "Vượt quota". Chưa có cờ "chưa định giá" theo dòng (xem spec-decisions) → hiện số tiền như contract trả.
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/shared/panel/Panel";
import { Badge } from "@/components/ui/badge";
import { pickLocalized } from "@/lib/localized";
import { formatCount, formatUsd } from "@/lib/quota-format";
import type { UsageReport } from "../lib/types";

export const TOP_FEATURE_ROWS = 5;

type Err = { message: string; code: string; onRetry?: () => void };
type Feature = UsageReport["top_features"][number];
type User = UsageReport["top_users"][number];
type Props<T> = { rows?: T[]; loading?: boolean; error?: Err };

function Head({ first }: { first: string }) {
  const { t } = useTranslation();
  return (
    <thead>
      <tr className="text-left text-caption text-muted-foreground">
        <th scope="col" className="pb-2 font-medium">
          {first}
        </th>
        {(["runs", "tokens", "billable"] as const).map((c) => (
          <th key={c} scope="col" className="pb-2 font-medium">
            {t(`usage.col.${c}`)}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function FeatureName({ f }: { f: Feature }) {
  const { t, i18n } = useTranslation();
  if (f.feature_id === null) {
    return (
      <span title={t("usage.noFeatureNote")} className="text-muted-foreground">
        {t("usage.noFeature")}
      </span>
    );
  }
  return <>{f.feature_name ? pickLocalized(f.feature_name, i18n.language) : f.feature_key}</>;
}

type RowProps = { name: React.ReactNode; runs: number; tokens: number; usd: string };

function Row({ name, runs, tokens, usd }: RowProps) {
  const { i18n } = useTranslation();
  return (
    <tr className="border-t">
      <th scope="row" className="py-2 text-left font-medium">
        {name}
      </th>
      <td className="py-2">{formatCount(runs, i18n.language)}</td>
      <td className="py-2">{formatCount(tokens, i18n.language)}</td>
      <td className="py-2">{formatUsd(usd, i18n.language)}</td>
    </tr>
  );
}

export function TopFeatures({ rows, loading, error }: Props<Feature>) {
  const { t } = useTranslation();
  const top = (rows ?? []).slice(0, TOP_FEATURE_ROWS);
  return (
    <Panel title={t("usage.topFeature.title")} loading={loading} error={error}>
      {top.length ? (
        <table className="w-full text-body">
          <Head first={t("usage.col.feature")} />
          <tbody>
            {top.map((f) => (
              <Row
                key={f.feature_id ?? "none"}
                name={
                  <span className="flex flex-wrap items-center gap-2">
                    <FeatureName f={f} />
                    {f.overage ? <Badge variant="err">{t("quota.badge.over")}</Badge> : null}
                  </span>
                }
                runs={f.runs}
                tokens={f.tokens}
                usd={f.billable_usd}
              />
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-body text-muted-foreground">{t("usage.empty.rows")}</p>
      )}
    </Panel>
  );
}

export function TopUsers({ rows, loading, error }: Props<User>) {
  const { t } = useTranslation();
  return (
    <Panel title={t("usage.topUser.title")} loading={loading} error={error}>
      {rows?.length ? (
        <table className="w-full text-body">
          <Head first={t("usage.col.user")} />
          <tbody>
            {rows.map((u) => (
              <Row
                key={u.user_id ?? "none"}
                name={u.display_name ?? u.username ?? "—"}
                runs={u.runs}
                tokens={u.tokens}
                usd={u.billable_usd}
              />
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-body text-muted-foreground">{t("usage.empty.rows")}</p>
      )}
    </Panel>
  );
}
