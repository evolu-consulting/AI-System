// price-scout · ô nhập "Cấu hình dò giá" ở màn SP: bật dò + lịch tự động (vận hành) + MỘT ô "Yêu cầu dò giá" viết tự do.
// Các ô cấu trúc cũ vẫn nằm trong form (giữ nguyên giá trị lưu, vd % cảnh báo) nhưng không hiện ở đây.
import { useTranslation } from "react-i18next";
import { INSTRUCTIONS_MAX, type ScoutForm } from "../lib/scout";

const FIELD =
  "w-full rounded-lg border border-field bg-panel px-3 py-2 text-body outline-none focus-visible:ring-2 focus-visible:ring-act disabled:opacity-60";

type Props = { form: ScoutForm; set: (f: ScoutForm) => void; disabled: boolean };

export function ScoutProductFields({ form, set, disabled }: Props) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.scout.${k}`);
  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-label">
        <input
          type="checkbox"
          data-testid="scout-enabled"
          checked={form.enabled}
          disabled={disabled}
          onChange={(e) => set({ ...form, enabled: e.target.checked })}
        />
        {L("f.enabled")}
      </label>
      <div className="flex flex-col gap-1">
        <label htmlFor="scout-instructions" className="text-label text-ink-2">
          {L("f.instructions")}
        </label>
        <textarea
          id="scout-instructions"
          data-testid="scout-instructions"
          rows={5}
          maxLength={INSTRUCTIONS_MAX + 500}
          className={FIELD}
          value={form.instructions}
          disabled={disabled}
          placeholder={L("ph.instructions")}
          onChange={(e) => set({ ...form, instructions: e.target.value })}
        />
        <p className="text-xs text-dim">{L("help.instructions")}</p>
      </div>
      <div className="flex max-w-xs flex-col gap-1">
        <label htmlFor="scout-schedule" className="text-label text-ink-2">
          {L("f.schedule")}
        </label>
        <select
          id="scout-schedule"
          data-testid="scout-schedule"
          className={FIELD}
          value={form.schedule}
          disabled={disabled}
          onChange={(e) => set({ ...form, schedule: e.target.value as ScoutForm["schedule"] })}
        >
          <option value="off">{L("schedule.off")}</option>
          <option value="weekly">{L("schedule.weekly")}</option>
          <option value="monthly">{L("schedule.monthly")}</option>
        </select>
      </div>
    </div>
  );
}
