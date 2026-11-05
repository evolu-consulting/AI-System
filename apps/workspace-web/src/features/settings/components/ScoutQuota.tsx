// price-scout · Cài đặt › trần lượt dò & token mỗi tháng (trống = theo mặc định hệ thống / không giới hạn). Ô `platform_*` chỉ hiện khi
// `can_override` (platform_admin). Hiện mức đã dùng tháng này.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { parseCap } from "~/features/product-suppliers/lib/scout";
import { useSaveScoutQuota, useScoutQuota } from "../hooks/use-scout-settings";
import { saveErrorText } from "../lib/scout-ui";
import { FIELD, Panel, Row } from "./controls";

const KEYS = [
  "searches_month",
  "tokens_month",
  "platform_searches_month",
  "platform_tokens_month",
] as const;
type Key = (typeof KEYS)[number];
type Draft = Record<Key, string>;

export function ScoutQuota({ owner }: { owner: boolean }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.scout.${k}`, o);
  const q = useScoutQuota();
  const save = useSaveScoutQuota();
  const d = q.data;
  const [v, setV] = useState<Draft | null>(null);
  useEffect(() => {
    if (d)
      setV(Object.fromEntries(KEYS.map((k) => [k, d[k] == null ? "" : String(d[k])])) as Draft);
  }, [d]);
  if (!d || !v) return null;
  const keys = KEYS.filter((k) => d.can_override || !k.startsWith("platform_"));
  const parsed = Object.fromEntries(keys.map((k) => [k, parseCap(v[k])]));
  const bad = Object.values(parsed).includes(undefined);
  const lim = d.usage.searches_limit;
  return (
    <Panel title={L("quota.title")} sub={L("quota.hint")}>
      <p data-testid="scout-quota-usage" className="px-5 pt-3 text-caption text-dim">
        {L("usage", { used: d.usage.searches, limit: lim == null ? L("unlimited") : lim })} ·{" "}
        {L("quota.tokens", { n: d.usage.tokens })}
      </p>
      {keys.map((k) => (
        <Row key={k} label={L(`quota.${k}`)} htmlFor={`scq-${k}`}>
          <input
            id={`scq-${k}`}
            data-testid={`scq-${k}`}
            inputMode="numeric"
            className={`${FIELD} max-w-60`}
            value={v[k]}
            disabled={!owner || save.isPending}
            placeholder={L("quota.empty")}
            onChange={(e) => setV({ ...v, [k]: e.target.value })}
          />
        </Row>
      ))}
      {bad && (
        <p role="alert" className="px-5 pb-2 text-caption text-late">
          {L("quota.invalid")}
        </p>
      )}
      <div className="flex justify-end px-5 py-3">
        <button
          type="button"
          className="btn btn-primary"
          data-testid="scout-quota-save"
          disabled={!owner || save.isPending || bad}
          onClick={() =>
            save.mutate(parsed as Parameters<typeof save.mutate>[0], {
              onSuccess: () => toast(L("saved")),
              onError: (e) => toast(saveErrorText(e, t), "late"),
            })
          }
        >
          {L("save")}
        </button>
      </div>
    </Panel>
  );
}
