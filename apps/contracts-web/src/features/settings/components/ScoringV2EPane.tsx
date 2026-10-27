// REP-v3-ui · engine V2-E · Cài đặt › "Điểm uy tín": 5 ô nhóm SP × vai (3 tab Tiêu chí · Thời gian · Loại việc) + "Mức & đánh giá" + thử tính.
// Lưu riêng ở đây (thanh Lưu/Bỏ thay đổi của mục này), từng phần đã đổi; chỉ chủ sở hữu (`owner`) lưu được. Cấu hình điểm HD8 (`/scoring/:role`,
// chỉnh tay ±10) không hiện ở engine này.
import { ApiError } from "@ai/web-kit/http";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { useRepState, useSaveRep } from "../hooks/use-rep";
import { firstRepIssue, repAnyChanged, repChangedParts } from "../lib/rep-data";
import type { CellTab, RepData, RepSel } from "../lib/rep-types";
import { RepPane } from "./RepPane";

const BTN =
  "h-8 rounded-lg border border-rule px-3 text-label text-ink-2 hover:bg-panel disabled:opacity-50";

export function ScoringV2EPane({ owner }: { owner: boolean }) {
  const { t } = useTranslation();
  const s = (k: string) => t(`contracts.settings.${k}`);
  const { state, loading, error, retry } = useRepState();
  const save = useSaveRep();
  const [draft, setDraft] = useState<RepData | null>(null);
  const [sel, setSel] = useState<RepSel>("service:supplier");
  const [tab, setTab] = useState<CellTab>("crit");
  const saved = state?.saved;
  const savedKey = useMemo(() => JSON.stringify(saved ?? null), [saved]);
  // Bản lưu đổi (mở lần đầu, sau khi Lưu) ⇒ nháp = bản mới.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ theo nội dung đã lưu
  useEffect(() => {
    if (saved) setDraft(structuredClone(saved));
  }, [savedKey]);
  if (loading) return <p className="text-label text-dim">{t("contracts.common.loading")}</p>;
  if (error || !state || !draft)
    return (
      <p role="alert" className="text-label text-late">
        {s("loadFail")}{" "}
        <button type="button" className="underline" onClick={retry}>
          {t("contracts.common.retry")}
        </button>
      </p>
    );
  const ch = repChangedParts(draft, state.saved);
  const dirty = repAnyChanged(ch);
  const issue = firstRepIssue(draft, ch);
  const doSave = () =>
    save.mutate(
      { data: draft, ch },
      {
        onSuccess: () => toast(s("saved")),
        onError: (e) =>
          toast(e instanceof ApiError && e.status === 422 ? e.message : s("saveFail"), "late"),
      },
    );
  return (
    <div data-testid="rep-v2e">
      {owner ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-caption text-dim">
            {dirty ? <b className="text-soon">{s("unsaved")}</b> : s("customised")}
          </span>
          <button
            type="button"
            disabled={!dirty}
            onClick={() => setDraft(structuredClone(state.saved))}
            className={BTN}
          >
            {s("discard")}
          </button>
          <button
            type="button"
            data-testid="rep-save"
            disabled={!dirty || save.isPending || issue !== null}
            title={issue ? s(issue) : undefined}
            onClick={doSave}
            className="h-8 rounded-lg bg-act px-4 text-label font-semibold text-on-act disabled:opacity-50"
          >
            {s("save")}
          </button>
        </div>
      ) : (
        <p className="mb-4 text-caption text-dim">{s("readOnly")}</p>
      )}
      <fieldset disabled={!owner || save.isPending} className="min-w-0 border-0 p-0">
        <RepPane
          data={draft}
          saved={state.saved}
          defaults={state.defaults}
          sel={sel}
          tab={tab}
          onSel={setSel}
          onTab={setTab}
          set={setDraft}
        />
      </fieldset>
    </div>
  );
}
