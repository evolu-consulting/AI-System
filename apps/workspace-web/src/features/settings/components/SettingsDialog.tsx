// V2-L · hộp thoại Cài đặt (mở từ menu avatar): đầu có Khôi phục tất cả · Bỏ thay đổi · Lưu cài đặt; trái là 3 mục (Công ty · Điểm uy tín ·
// Điểm kinh doanh) cuộn riêng; mục khác mặc định có chấm cam. Chỉ chủ sở hữu (contracts-owner) sửa được; người khác xem (mọi ô khoá).
// Bản nháp giữ khi đóng hộp thoại; tên/màu/giao diện nháp áp ngay lên sidebar, menu, nút (kho `brandStore`), đóng chưa lưu ⇒ trở về đã lưu.

import { toast } from "@ai/web-kit/ui/toast";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsDialogFrame, SettingsLayout } from "~/shared/ui/settings-layout";
import { useShellPacks } from "~/shell/use-shell-packs";
import { brandOf, useSaveSettings, useSettingsState } from "../hooks/use-settings";
import { brandStore } from "../lib/brand";
import { settingsBus, useSettingsOpen } from "../lib/bus";
import { anyChanged, changedParts, firstIssue, same, settledCompany } from "../lib/data";
import { pickNav } from "../lib/section-key";
import type { SectionId, SettingsData, SettingsNavId } from "../lib/types";
import { Dot } from "./controls";
import { SettingsBody } from "./SettingsBody";
import { SettingsActions } from "./SettingsHeader";
import { buildNavGroups } from "./SettingsNav";

/** CR-108 · mục chỉ xem và không có nháp chưa lưu ⇒ ẩn thanh Lưu (ký số trong mục này tự lưu khi bấm). */
const noSaveFor = (s: SectionId, dirty: boolean) => (s === "flow" || s === "sign") && !dirty;

/** Mục có chấm cam "đã khác mặc định"? Điểm uy tín / dò giá / quy trình lưu riêng (không nằm trong bản nháp) ⇒ không chấm. */
function sectionChanged(k: SectionId, vsDef: ReturnType<typeof changedParts> | null) {
  if (!vsDef || k === "scout" || k === "flow" || k === "sign" || k === "rep") return false;
  return k === "co" ? vsDef.company : vsDef.biz;
}

export function SettingsDialog({ owner, tenantName }: { owner: boolean; tenantName: string }) {
  const { t } = useTranslation();
  const saveSettings = useSaveSettings();
  const open = useSettingsOpen();
  // CR-130 · MỘT trang Cài đặt: nhóm Sổ Hợp Tác (gói contracts) + nhóm Bảng tin (gói Cộng đồng); người chỉ có Cộng đồng chỉ thấy Bảng tin.
  const packs = useShellPacks();
  const hasContracts = packs.contracts === true;
  const hasFeed = packs.community === true;
  const { state, loading, error, retry } = useSettingsState(open && hasContracts);
  const [draft, setDraft] = useState<SettingsData | null>(null);
  const [picked, setSec] = useState<SettingsNavId>("co");
  const sec = pickNav(picked, hasContracts, hasFeed, owner);
  const csec = sec === "feed" ? null : sec;
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
    if (r.ok) {
      toast(s("saved"));
      setDraft((d) => d && { ...d, company: settledCompany(d.company) });
    } else toast(r.message ?? s("saveFail"), "late");
    setSaving(false);
  };
  // Mở từ nơi khác với mục chỉ định (vd thẻ duyệt ⇒ "Quy trình duyệt").
  useEffect(() => {
    if (!open) return;
    const want = settingsBus.takeSection();
    if (want) setSec(want);
  }, [open]);

  const groups = buildNavGroups({
    hasContracts,
    hasFeed,
    owner,
    s,
    dot: (k) => (sectionChanged(k, vsDef) ? <Dot label={s("changed")} /> : undefined),
  });

  return (
    <SettingsDialogFrame
      open={open}
      onOpenChange={(o) => settingsBus.set(o)}
      title={s("title")}
      description={csec ? s("scope") : undefined}
      actions={
        csec && (
          <SettingsActions
            owner={owner}
            dirty={dirty}
            isDefault={!vsDef || !anyChanged(vsDef)}
            saving={saving}
            issue={issue}
            noSave={noSaveFor(csec as SectionId, dirty)}
            onReset={() => defaults && setDraft(structuredClone(defaults))}
            onDiscard={() => saved && setDraft(structuredClone(saved))}
            onSave={() => void save()}
          />
        )
      }
    >
      <SettingsLayout
        navLabel={s("sections")}
        groups={groups}
        active={sec}
        onSelect={(id) => setSec(id as SettingsNavId)}
      >
        <SettingsBody
          sec={sec}
          owner={owner}
          tenantName={tenantName}
          load={{ loading, error, retry }}
          form={draft && saved && defaults ? { draft, defaults, setDraft, saving } : null}
        />
      </SettingsLayout>
    </SettingsDialogFrame>
  );
}
