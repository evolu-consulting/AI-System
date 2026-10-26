// V2-L · hộp thoại Cài đặt (mở từ menu avatar): đầu có Khôi phục tất cả · Bỏ thay đổi · Lưu cài đặt; trái là 3 mục (Công ty · Điểm uy tín ·
// Điểm kinh doanh) cuộn riêng; mục khác mặc định có chấm cam. Chỉ chủ sở hữu (contracts-owner) sửa được; người khác xem (mọi ô khoá).
// Bản nháp giữ khi đóng hộp thoại; tên/màu/giao diện nháp áp ngay lên sidebar, menu, nút (kho `brandStore`), đóng chưa lưu ⇒ trở về đã lưu.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { brandOf, useSaveSettings, useSettingsState } from "../hooks/use-settings";
import { brandStore } from "../lib/brand";
import { settingsBus, useSettingsOpen } from "../lib/bus";
import { anyChanged, changedParts, firstIssue, same } from "../lib/data";
import type { SectionId, SettingsData } from "../lib/types";
import { BizPane } from "./BizPane";
import { CompanyPane } from "./CompanyPane";
import { Dot } from "./controls";
import { FlowPane } from "./FlowPane";
import { ScoringPane } from "./ScoringPane";
import { ScoutPane } from "./ScoutPane";
import { SettingsHeader } from "./SettingsHeader";

/** Mục dùng bản nháp chung + nút Lưu chung (công ty, điểm kinh doanh); còn lại lưu riêng. */
const isDraftSection = (s: SectionId) => s === "co" || s === "biz";
const SECTIONS: readonly SectionId[] = ["co", "rep", "biz", "scout", "flow"];

/** Mục có chấm cam "đã khác mặc định"? Điểm uy tín / dò giá / quy trình lưu riêng (không nằm trong bản nháp) ⇒ không chấm. */
function sectionChanged(k: SectionId, vsDef: ReturnType<typeof changedParts> | null) {
  if (!vsDef || k === "scout" || k === "flow" || k === "rep") return false;
  return k === "co" ? vsDef.company : vsDef.biz;
}

function LoadState({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: unknown;
  retry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {loading && <p className="text-dim">{t("contracts.common.loading")}</p>}
      {error && (
        <p role="alert" className="text-late">
          {t("contracts.settings.loadFail")}{" "}
          <button type="button" className="underline" onClick={retry}>
            {t("contracts.common.retry")}
          </button>
        </p>
      )}
    </>
  );
}

export function SettingsDialog({ owner, tenantName }: { owner: boolean; tenantName: string }) {
  const { t } = useTranslation();
  const saveSettings = useSaveSettings();
  const open = useSettingsOpen();
  const { state, loading, error, retry } = useSettingsState(open);
  const [draft, setDraft] = useState<SettingsData | null>(null);
  const [sec, setSec] = useState<SectionId>("co");
  const [saving, setSaving] = useState(false);
  const s = (k: string) => t(`contracts.settings.${k}`);

  // Dữ liệu đã lưu đổi (mở lần đầu, sau khi Lưu) ⇒ bản nháp = bản mới (không đè nháp đang chỉnh dở: chỉ khi nháp chưa khác bản lưu cũ).
  const last = useRef<SettingsData | null>(null);
  useEffect(() => {
    if (!state || same(last.current, state.saved)) return;
    last.current = state.saved;
    setDraft(structuredClone(state.saved));
  }, [state]);
  useEffect(() => {
    brandStore.setPreview(open && draft ? brandOf(draft.company) : null);
    return () => brandStore.setPreview(null);
  }, [open, draft]);

  const saved = state?.saved;
  const defaults = state?.defaults;
  const vsSaved = draft && saved ? changedParts(draft, saved) : null;
  const vsDef = draft && defaults ? changedParts(draft, defaults) : null;
  const dirty = vsSaved ? anyChanged(vsSaved) : false;
  const issue = draft && vsSaved ? firstIssue(draft, vsSaved) : null;

  const save = async () => {
    if (!draft || !vsSaved || issue) return;
    setSaving(true);
    const r = await saveSettings(draft, vsSaved);
    if (r.ok) toast(s("saved"));
    else toast(r.message ?? s("saveFail"), "late");
    setSaving(false);
  };
  // Mở từ nơi khác với mục chỉ định (vd thẻ duyệt ⇒ "Quy trình duyệt").
  useEffect(() => {
    if (!open) return;
    const want = settingsBus.takeSection();
    if (want) setSec(want);
  }, [open]);
  const dot = (k: SectionId) => sectionChanged(k, vsDef);

  return (
    <Dialog open={open} onOpenChange={(o) => settingsBus.set(o)}>
      <DialogContent
        aria-describedby={undefined}
        className="h-[min(860px,calc(100dvh-2.5rem))] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[1120px]"
      >
        <SettingsHeader
          owner={owner}
          dirty={dirty}
          isDefault={!vsDef || !anyChanged(vsDef)}
          saving={saving}
          issue={issue}
          onReset={() => defaults && setDraft(structuredClone(defaults))}
          onDiscard={() => saved && setDraft(structuredClone(saved))}
          onSave={() => void save()}
        />
        <div className="grid min-h-0 grid-cols-[250px_minmax(0,1fr)] max-md:grid-cols-1 max-md:grid-rows-[auto_minmax(0,1fr)]">
          <nav
            aria-label={s("sections")}
            className="flex flex-col gap-1 overflow-y-auto border-r border-rule p-3 max-md:flex-row max-md:overflow-x-auto max-md:border-r-0 max-md:border-b"
          >
            {SECTIONS.map((k) => (
              <button
                key={k}
                type="button"
                aria-current={sec === k}
                onClick={() => setSec(k)}
                className={`grid w-full grid-cols-[1fr_auto] items-start gap-2 rounded-[10px] border px-3 py-2.5 text-left ${sec === k ? "border-act-line bg-act-soft" : "border-transparent hover:bg-sunk"}`}
              >
                <span className="flex flex-col">
                  <b className={`text-label ${sec === k ? "text-act" : ""}`}>{s(`sec.${k}`)}</b>
                  <span className="text-caption font-normal text-dim max-md:hidden">
                    {s(`sec.${k}Hint`)}
                  </span>
                </span>
                {dot(k) && <Dot label={s("changed")} />}
              </button>
            ))}
          </nav>
          <div className="min-w-0 overflow-y-auto p-5" id="settings-scroll">
            <LoadState loading={loading} error={error} retry={retry} />

            {sec === "scout" && <ScoutPane />}
            {sec === "flow" && <FlowPane owner={owner} />}
            {sec === "rep" && <ScoringPane owner={owner} />}
            {isDraftSection(sec) && draft && saved && defaults && (
              <fieldset disabled={!owner || saving} className="min-w-0 border-0 p-0">
                {sec === "co" && (
                  <>
                    <h2 className="mb-3 text-lg font-semibold">{s("sec.co")}</h2>
                    <CompanyPane
                      value={draft.company}
                      tenantName={tenantName}
                      set={(company) => setDraft({ ...draft, company })}
                    />
                  </>
                )}
                {sec === "biz" && (
                  <BizPane
                    value={draft.biz}
                    defaults={defaults.biz}
                    set={(biz) => setDraft({ ...draft, biz })}
                  />
                )}
              </fieldset>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
