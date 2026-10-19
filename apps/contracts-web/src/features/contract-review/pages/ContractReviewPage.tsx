// HD-FR-22 · HD-FR-23 · HD-FR-26 · S05 · D-02 · D2-05: màn kiểm/sửa HĐ — port `ContractPage.tsx:27-118` (tiêu đề + dòng phụ theo
// trạng thái, "Xem file gốc", "Lưu", thông báo, cảnh báo, trường + trích dẫn, bảng hàng). Bỏ "Xác nhận" (HD3), "Ghi việc" (HD7),
// điền sẵn của trợ lý (HD6). Đang đọc ⇒ tải lại mỗi 2 s như mgmt-app (tới khi có kênh đẩy trạng thái gói).
import type { ContractDetail, ContractFieldKey } from "@ai/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHead } from "~/components/shared/layout";
import { ErrorLine, Loading } from "~/components/shared/states";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { contractKey, fetchContract, fileHref, patchContractFields } from "../api";
import { ReviewFields } from "../components/ReviewFields";
import {
  ExtractFailed,
  ItemsTable,
  ReviewActions,
  SaveNotice,
  WarningList,
} from "../components/ReviewParts";
import { changedFields, type Draft, draftOf, leadKey, warningsOf } from "../lib/review";
import { saveErrorText } from "../lib/save-error";

const READING_REFRESH_MS = 2000;

/** "Lưu": chỉ ô đã đổi, khoá `version`; trả trạng thái nút + thông báo. */
function useSave(id: string) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (c: ContractDetail, draft: Draft) => {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const fields = changedFields(c, draft);
      if (Object.keys(fields).length) await patchContractFields(id, c.version, fields);
      await qc.invalidateQueries({ queryKey: contractKey(id) });
      setMsg(t("contracts.review.saved"));
    } catch (e) {
      setErr(saveErrorText(e, t));
    } finally {
      setBusy(false);
    }
  };
  return { msg, err, busy, save };
}

export function ContractReviewPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const { write } = useMe();
  const q = useQuery({
    queryKey: contractKey(id),
    queryFn: ({ signal }) => fetchContract(id, signal),
    refetchInterval: (s) => (s.state.data?.status === "extracting" ? READING_REFRESH_MS : false),
  });
  const [draft, setDraft] = useState<Draft>({});
  const s = useSave(id);

  useEffect(() => {
    if (q.data) setDraft(draftOf(q.data));
  }, [q.data]);

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorLine error={q.error} />;
  const c = q.data;
  const canSave = write && c.status !== "extracting";
  const file = c.file ? { href: fileHref(id), name: c.file.name } : null;
  const lead = leadKey(c.status);
  const title = (typeof c.fields.title.value === "string" && c.fields.title.value) || c.title;
  const failed = c.status === "extract_failed";
  return (
    // Thân trang như mgmt-app (`index.css:78-82`: 16 px, line-height 1.55) — Shell giữ thang chữ của nó.
    <div className="text-base leading-[1.55]">
      <PageHead
        crumb={
          <Link to="/contracts" className="hover:underline">
            {t("contracts.review.back")}
          </Link>
        }
        title={title}
        lead={lead ? t(lead) : undefined}
        actions={
          (file || canSave) && (
            <ReviewActions
              file={file}
              canSave={canSave}
              busy={s.busy}
              onSave={() => s.save(c, draft)}
            />
          )
        }
      />
      <SaveNotice msg={s.msg} err={s.err} />
      <WarningList warnings={warningsOf(c)} />
      {failed ? (
        <ExtractFailed fileHref={file?.href ?? null} />
      ) : (
        <ReviewFields
          contract={c}
          draft={draft}
          write={write}
          onChange={(k: ContractFieldKey, v: string) => setDraft((d) => ({ ...d, [k]: v }))}
        />
      )}
      <ItemsTable items={c.items} />
    </div>
  );
}
