// CR-120 · G3/G4 · khối stage "Chờ N giờ" / "Chờ sự kiện": số giờ hoặc khoá sự kiện + hạn; "Sau giai đoạn" cố định = tự chạy tiếp.
// CR-123 · FR-13 (ux-audit #13): trong trình sửa quy trình, "Chờ ký xong" chọn "Khi ký xong / bị từ chối / bị huỷ" từ danh sách —
// không hiện mã sự kiện (ô gõ mã chỉ còn cho quản trị nền tảng).
import { getAppManifest } from "@ai/contracts/app-manifest";
import { useTranslation } from "react-i18next";
import { useSession } from "@/lib/auth/use-session";
import { useFlowCtx } from "../flow/flow-ctx";
import { SelectField, TextField } from "./Fields";
import type { StageFormProps } from "./stage-form-props";

const K = "process.admin.editor.stage.timedWait.";

/** CR-125 · m6b · tín hiệu người dùng công ty chọn được ở "Chờ sự kiện": app khai `pick` trên tín hiệu (không còn danh sách ký số cứng ở đây). */
export const pickSignals = (app: string | undefined): { key: string; label: string }[] =>
  (app ? (getAppManifest(app)?.signals ?? []) : []).filter((s) => s.pick === true);

/** Chọn sự kiện từ danh sách (người dùng công ty) hoặc gõ khoá (quản trị nền tảng / trình sửa cũ). */
function EventField(p: {
  id: string;
  ev: string;
  signals: readonly { key: string; label: string }[];
  pickList: boolean;
  readOnly: boolean;
  error: string | undefined;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  const known = p.signals.some((s) => s.key === p.ev);
  if (!p.pickList)
    return (
      <>
        <TextField
          id={p.id}
          label={t(`${K}event`)}
          value={p.ev}
          readOnly={p.readOnly}
          mono
          alert
          error={p.error}
          onChange={p.onChange}
        />
        <p className="text-caption text-muted-foreground">{t(`${K}eventHint`)}</p>
      </>
    );
  return (
    <SelectField
      id={p.id}
      label={t(`${K}eventPick`)}
      value={p.ev}
      readOnly={p.readOnly}
      alert
      error={p.error}
      options={[
        ...p.signals.map((s) => ({
          value: s.key,
          label: t(`${K}events.${s.key.split(".")[1]}`, { defaultValue: s.label }),
        })),
        ...(p.ev !== "" && !known ? [{ value: p.ev, label: t(`${K}events.other`) }] : []),
      ]}
      onChange={p.onChange}
    />
  );
}

export function StageTimedWait(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, index, errors, readOnly, onChange } = p;
  const flow = useFlowCtx();
  const isPlatform = useSession((s) => s.me?.role) === "platform_admin";
  const w = stage.wait;
  const set = (patch: Partial<typeof w>) => onChange({ wait: { ...w, ...patch } });
  const err = (f: string) => {
    const k = errors[`stages.${index}.executor.${f}`];
    return k ? t(k) : undefined;
  };
  const ev = w.event ?? "";
  const signals = pickSignals(flow?.app);
  const known = signals.some((s) => s.key === ev);
  const pickList = !!flow && (known || ev === "" || !isPlatform);
  return (
    <fieldset aria-label={t(`${K}hours`)} className="space-y-3" data-testid="stage-timed-wait">
      {stage.executor === "wait_for" ? (
        <TextField
          id={`${stage.uid}-wf-hours`}
          label={t(`${K}hours`)}
          type="number"
          value={w.hours ?? ""}
          min={1}
          max={8760}
          readOnly={readOnly}
          alert
          error={err("hours")}
          onChange={(v) => set({ hours: v })}
        />
      ) : (
        <>
          <EventField
            id={`${stage.uid}-we-event`}
            ev={ev}
            signals={signals}
            pickList={pickList}
            readOnly={readOnly}
            error={err("event")}
            onChange={(v) => set({ event: v })}
          />
          <TextField
            id={`${stage.uid}-we-timeout`}
            label={t(flow ? `${K}timeoutFlow` : `${K}timeoutH`)}
            type="number"
            value={w.timeoutH ?? ""}
            min={1}
            max={8760}
            readOnly={readOnly}
            alert
            error={err("timeout_h")}
            onChange={(v) => set({ timeoutH: v })}
          />
          <p className="text-caption text-muted-foreground">
            {t(flow ? `${K}timeoutHintFlow` : `${K}timeoutHint`)}
          </p>
        </>
      )}
    </fieldset>
  );
}
