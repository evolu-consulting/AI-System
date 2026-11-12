// REP-v3-ui · engine V2-E · Cài đặt › "Điểm uy tín": 5 ô nhóm SP × vai (3 tab Tiêu chí · Thời gian · Loại việc) + "Mức & đánh giá" + thử tính.
// Lưu riêng ở đây (thanh Lưu/Bỏ thay đổi của mục này), từng phần đã đổi; chỉ chủ sở hữu (`owner`) lưu được. Cấu hình điểm HD8 (`/scoring/:role`,
// chỉnh tay ±10) không hiện ở engine này.

import { toast } from "@ai/web-kit/ui/toast";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PaneSkeleton } from "~/components/shared/Refreshing";
import { Btn } from "~/components/ui/Btn";
import { ApiError } from "~/lib/api-error";
import { useRepState, useSaveRep } from "../hooks/use-rep";
import { firstRepIssue, repAnyChanged, repChangedParts } from "../lib/rep-data";
import type { CellTab, RepData, RepSel } from "../lib/rep-types";
import { RepPane } from "./RepPane";

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
  if (loading) return <PaneSkeleton lines={4} />;
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
  const lock = owner ? undefined : s("readOnly"); // Q7
  return (
    <div data-testid="rep-v2e">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-caption text-dim">
          {!owner ? (
            s("readOnly")
          ) : dirty ? (
            <b className="text-soon">{s("unsaved")}</b>
          ) : (
            s("customised")
          )}
        </span>
        <Btn
          size="sm"
          disabled={!owner || !dirty}
          reason={lock}
          onClick={() => setDraft(structuredClone(state.saved))}
        >
          {s("discard")}
        </Btn>
        <Btn
          size="sm"
          variant="primary"
          data-testid="rep-save"
          disabled={!owner || !dirty || issue !== null}
          loading={save.isPending}
          reason={lock ?? (issue ? s(issue) : undefined)}
          onClick={doSave}
        >
          {s("save")}
        </Btn>
      </div>
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
