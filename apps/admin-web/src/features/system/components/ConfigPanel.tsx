// CR-104 · ops-ui · khối "Cấu hình": tần suất (5–1440 phút), mỗi check: bật/tắt + ngưỡng warn/crit theo OPS_CHECK_META.
// Kiểm phía client phản chiếu contract; 422 của Hub hiện theo ô. "Khôi phục mặc định" chỉ điền form, cần Lưu.
import {
  OPS_CHECK_KEYS,
  OPS_CHECK_META,
  OPS_DEFAULT_SETTINGS,
  OPS_EVERY_MIN,
  type OpsCheckKey,
  type OpsSettings,
} from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  type Draft,
  type FieldError,
  type SettingsErrors,
  sameSettings,
  validateSettings,
} from "../lib/ops";

type Props = {
  server: OpsSettings;
  saving: boolean;
  /** Trả lỗi theo ô (422) hoặc null khi đã lưu. */
  onSave: (s: OpsSettings) => Promise<SettingsErrors | null>;
};

const toDraft = (raw: string): Draft => (raw.trim() === "" ? null : Number(raw));
const show = (v: Draft | undefined): string =>
  v === null || v === undefined || Number.isNaN(v) ? "" : String(v);

export function ConfigPanel({ server, saving, onSave }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<OpsSettings | null>(null);
  const [remote, setRemote] = useState<SettingsErrors>({});
  const cur = draft ?? server;
  const dirty = draft !== null && !sameSettings(draft, server);
  const local = dirty ? validateSettings(cur) : {};
  const errs: SettingsErrors = { ...remote, ...local };
  const invalid = Object.keys(local).length > 0;

  const edit = (next: OpsSettings) => {
    setRemote({});
    setDraft(next);
  };
  const setCheck = (k: OpsCheckKey, patch: Partial<OpsSettings["checks"][OpsCheckKey]>) =>
    edit({ ...cur, checks: { ...cur.checks, [k]: { ...cur.checks[k], ...patch } } });

  const msg = (e: FieldError): string =>
    e.code === "range"
      ? t("system.err.range", { min: e.min, max: e.max })
      : e.code === "order"
        ? t(e.order === "asc" ? "system.err.asc" : "system.err.desc")
        : e.code === "server"
          ? t("system.err.server", { message: e.message })
          : t(`system.err.${e.code}`);

  const save = async () => {
    const res = await onSave(cur);
    if (res === null) {
      setDraft(null);
      setRemote({});
    } else setRemote(res);
  };

  const field = (
    id: string,
    label: string,
    value: Draft | undefined,
    on: (v: Draft) => void,
    unit: string,
    range: string,
  ) => {
    const e = errs[id];
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            aria-label={label}
            aria-invalid={e ? true : undefined}
            aria-describedby={e ? `${id}-err` : undefined}
            className="w-24"
            value={show(value)}
            onChange={(ev) => on(toDraft(ev.target.value))}
          />
          <span className="text-xs text-muted-foreground">
            {unit} ({range})
          </span>
        </div>
        {e ? (
          <p id={`${id}-err`} role="alert" className="text-xs text-danger">
            {msg(e)}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <section aria-labelledby="sys-config" className="space-y-4">
      <div>
        <h2 id="sys-config" className="text-lg font-semibold">
          {t("system.config.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("system.config.desc")}</p>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("system.config.every")}</span>
        {field(
          "every_min",
          t("system.config.every"),
          cur.every_min,
          (v) => edit({ ...cur, every_min: v as number }),
          t("system.unit.min"),
          `${OPS_EVERY_MIN.min}–${OPS_EVERY_MIN.max}`,
        )}
      </div>
      <ul className="divide-y rounded-lg border">
        {OPS_CHECK_KEYS.map((k) => {
          const m = OPS_CHECK_META[k];
          const c = cur.checks[k];
          const name = t(`system.check.${k}`);
          const unit = t(`system.unit.${m.unit}`);
          return (
            <li key={k} data-testid={`cfg-${k}`} className="flex flex-wrap items-start gap-4 p-3">
              <div className="flex min-w-48 items-center gap-2">
                <Switch
                  aria-label={t("system.config.enabled", { name })}
                  checked={c.enabled}
                  onCheckedChange={(on) => setCheck(k, { enabled: on })}
                />
                <span className="text-sm font-medium">{name}</span>
              </div>
              {(["warn", "crit"] as const).map((lv) => {
                const r = m[lv];
                return r ? (
                  <div key={lv} className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">
                      {t(`system.config.${lv}`)}
                    </span>
                    {field(
                      `${k}.${lv}`,
                      `${name} ${t(`system.config.${lv}`)}`,
                      c[lv],
                      (v) => setCheck(k, { [lv]: v }),
                      unit,
                      `${r.min}–${r.max}`,
                    )}
                  </div>
                ) : null;
              })}
              <p className="basis-full text-xs text-muted-foreground">{m.note}</p>
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <Button type="button" disabled={!dirty || invalid || saving} onClick={() => void save()}>
          {saving ? t("system.config.saving") : t("system.config.save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => edit(structuredClone(OPS_DEFAULT_SETTINGS))}
        >
          {t("system.config.reset")}
        </Button>
      </div>
    </section>
  );
}
