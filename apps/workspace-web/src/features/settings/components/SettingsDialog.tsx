// V2-L · hộp thoại Cài đặt (mở từ menu avatar): đầu có Khôi phục tất cả · Bỏ thay đổi · Lưu cài đặt; trái là 3 mục (Công ty · Điểm uy tín ·
// Điểm kinh doanh) cuộn riêng; mục khác mặc định có chấm cam. Chỉ chủ sở hữu (contracts-owner) sửa được; người khác xem (mọi ô khoá).
// Bản nháp giữ khi đóng hộp thoại; tên/màu/giao diện nháp áp ngay lên sidebar, menu, nút (kho `brandStore`), đóng chưa lưu ⇒ trở về đã lưu.

import {
  Blocks,
  Building2,
  GitBranch,
  type LucideIcon,
  Search,
  Star,
  TrendingUp,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import {
  SettingsDialogFrame,
  SettingsLayout,
  type SettingsNavGroup,
  SettingsSection,
} from "~/shared/ui/settings-layout";
import { useCanSeeApps } from "../hooks/use-apps-settings";
import { brandOf, useSaveSettings, useSettingsState } from "../hooks/use-settings";
import { brandStore } from "../lib/brand";
import { settingsBus, useSettingsOpen } from "../lib/bus";
import { anyChanged, changedParts, firstIssue, same } from "../lib/data";
import type { SectionId, SettingsData } from "../lib/types";
import { BizPane } from "./BizPane";
import { CompanyPane } from "./CompanyPane";
import { Dot } from "./controls";
import { SectionPanes } from "./SectionPanes";
import { SettingsActions } from "./SettingsHeader";

/** Mục dùng bản nháp chung + nút Lưu chung (công ty, điểm kinh doanh); còn lại lưu riêng. */
const isDraftSection = (s: SectionId) => s === "co" || s === "biz";
const SECTIONS: readonly SectionId[] = ["co", "rep", "biz", "scout", "flow"];

const SECTION_ICON: Record<SectionId, LucideIcon> = {
  co: Building2,
  rep: Star,
  biz: TrendingUp,
  scout: Search,
  flow: GitBranch,
  apps: Blocks,
};

/** CR-118 §11.2 · "Ứng dụng & quy trình" chỉ cho quản trị công ty + chủ gói. */
const sectionsOf = (apps: boolean): readonly SectionId[] =>
  apps ? [...SECTIONS, "apps"] : SECTIONS;

/** CR-108 · mục chỉ xem và không có nháp chưa lưu ⇒ ẩn thanh Lưu (ký số trong mục này tự lưu khi bấm). Mục `apps` lưu riêng từng khe. */
const noSaveFor = (s: SectionId, dirty: boolean) => (s === "flow" && !dirty) || s === "apps";

/** Mục có chấm cam "đã khác mặc định"? Điểm uy tín / dò giá / quy trình lưu riêng (không nằm trong bản nháp) ⇒ không chấm. */
function sectionChanged(k: SectionId, vsDef: ReturnType<typeof changedParts> | null) {
  if (!vsDef || k === "scout" || k === "flow" || k === "rep" || k === "apps") return false;
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
  const apps = useCanSeeApps(owner);
  const sections = sectionsOf(apps.visible);

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

  const groups: SettingsNavGroup[] = [
    {
      id: "contracts",
      items: sections.map((k) => ({
        id: k,
        label: s(`sec.${k}`),
        hint: s(`sec.${k}Hint`),
        icon: SECTION_ICON[k],
        badge: dot(k) ? <Dot label={s("changed")} /> : undefined,
      })),
    },
  ];

  return (
    <SettingsDialogFrame
      open={open}
      onOpenChange={(o) => settingsBus.set(o)}
      title={s("title")}
      description={s("scope")}
      actions={
        <SettingsActions
          owner={owner}
          dirty={dirty}
          isDefault={!vsDef || !anyChanged(vsDef)}
          saving={saving}
          issue={issue}
          noSave={noSaveFor(sec, dirty)}
          onReset={() => defaults && setDraft(structuredClone(defaults))}
          onDiscard={() => saved && setDraft(structuredClone(saved))}
          onSave={() => void save()}
        />
      }
    >
      <SettingsLayout
        navLabel={s("sections")}
        groups={groups}
        active={sec}
        onSelect={(id) => setSec(id as SectionId)}
      >
        <LoadState loading={loading} error={error} retry={retry} />
        <SectionPanes sec={sec} owner={owner} appsTenantId={apps.tenantId} />
        {isDraftSection(sec) && draft && saved && defaults && (
          <fieldset disabled={!owner || saving} className="min-w-0 border-0 p-0">
            {sec === "co" && (
              <SettingsSection title={s("sec.co")} description={s("sec.coHint")}>
                <CompanyPane
                  value={draft.company}
                  tenantName={tenantName}
                  set={(company) => setDraft({ ...draft, company })}
                />
              </SettingsSection>
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
      </SettingsLayout>
    </SettingsDialogFrame>
  );
}
