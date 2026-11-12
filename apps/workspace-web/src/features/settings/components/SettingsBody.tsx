// CR-130 · thân hộp thoại Cài đặt chung: ngăn Bảng tin (module Cộng đồng, nạp lười) hoặc 5 ngăn Sổ Hợp Tác (nháp chung + ngăn lưu riêng).
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { PaneSkeleton } from "~/components/shared/Refreshing";
import { SettingsSection } from "~/shared/ui/settings-layout";
import type { SettingsData, SettingsNavId } from "../lib/types";
import { BizPane } from "./BizPane";
import { FeedSettingsPane } from "./FeedSettingsPane";
import { LoadState } from "./LoadState";
import { SectionPanes } from "./SectionPanes";
import { isDraftSection } from "./SettingsNav";

export type DraftForm = {
  draft: SettingsData;
  defaults: SettingsData;
  setDraft: (d: SettingsData) => void;
  saving: boolean;
};

// CR-138 · mục Công ty (bảng 12 màu, ô màu tự chọn, ảnh bìa) tải lười: giữ chunk Cài đặt trong ngân sách.
const CompanyPane = lazy(() => import("./CompanyPane").then((m) => ({ default: m.CompanyPane })));

export function SettingsBody({
  sec,
  owner,
  tenantName,
  load,
  form,
}: {
  sec: SettingsNavId;
  owner: boolean;
  tenantName: string;
  load: { loading: boolean; error: unknown; retry: () => void };
  form: DraftForm | null;
}) {
  const { t } = useTranslation();
  if (sec === "feed") return <FeedSettingsPane />;
  return (
    <>
      <LoadState {...load} />
      <SectionPanes sec={sec} owner={owner} />
      {isDraftSection(sec) && form && (
        <fieldset disabled={!owner || form.saving} className="min-w-0 border-0 p-0">
          {sec === "co" && (
            <SettingsSection
              title={t("contracts.settings.sec.co")}
              description={t("contracts.settings.sec.coHint")}
            >
              <Suspense fallback={<PaneSkeleton lines={4} />}>
                <CompanyPane
                  value={form.draft.company}
                  tenantName={tenantName}
                  set={(company) => form.setDraft({ ...form.draft, company })}
                />
              </Suspense>
            </SettingsSection>
          )}
          {sec === "biz" && (
            <BizPane
              value={form.draft.biz}
              defaults={form.defaults.biz}
              set={(biz) => form.setDraft({ ...form.draft, biz })}
            />
          )}
        </fieldset>
      )}
    </>
  );
}
