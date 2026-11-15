// CR-125 · cr125-form-step-card · ô «Đính kèm tệp» dùng chung: chọn tệp ⇒ tải ngay (`POST /attachments`) ⇒ giá trị ô = id tệp.
// `multiple=false` (ô `file_ref` của form: MỘT tệp, chọn lại thì thay) hoặc nhiều tệp (phiếu yêu cầu). Chỉ đọc: `FileNames`.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AttachField } from "~/components/shared/AttachField";
import { TruncText } from "~/components/shared/TruncText";
import { downloadAttachment, fetchAttachment, uploadAttachment } from "./attachments";

type Picked = { id: string; name: string };

export function FileUploadField({
  id,
  testId,
  label,
  ids,
  multiple = false,
  onChange,
}: {
  id: string;
  testId: string;
  label: string;
  ids: readonly string[];
  multiple?: boolean;
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const [names, setNames] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const add = async (list: File[]) => {
    if (!list.length) return;
    setBusy(true);
    setErr(false);
    try {
      const up: Picked[] = [];
      for (const file of multiple ? list : [list[0] as File])
        up.push({ id: (await uploadAttachment(file)).id, name: file.name });
      setNames((n) => [...n, ...up]);
      onChange(multiple ? [...ids, ...up.map((u) => u.id)] : up.map((u) => u.id));
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AttachField
      inputId={id}
      inputTestId={testId}
      itemTestId="file-item"
      ariaLabel={label}
      multiple={multiple}
      busy={busy}
      error={err ? t("contracts.flowPanel.file.failed") : undefined}
      items={ids.map((fid) => ({
        id: fid,
        name: names.find((n) => n.id === fid)?.name ?? fid,
        mime: "",
        status: "ready" as const,
      }))}
      onFiles={(fs) => void add(fs)}
      onRemove={(fid) => onChange(ids.filter((x) => x !== fid))}
    />
  );
}

/**
 * Chỉ đọc: tên tệp theo id (`GET /attachments/:id`) là LIÊN KẾT mở tệp (`/content` kèm Bearer). Hub chỉ cho người xem lượt (người gửi,
 * người được giao, quản trị công ty) ⇒ không đọc được (403/404) ⇒ chữ chung «Tệp đính kèm» + câu báo không mở được.
 */
export function FileName({ id }: { id: string }) {
  const { t } = useTranslation();
  const [denied, setDenied] = useState(false);
  const q = useQuery({
    queryKey: ["attachment", id],
    queryFn: ({ signal }) => fetchAttachment(id, signal),
    retry: false,
    staleTime: 300_000,
  });
  const name = q.data?.filename ?? t("contracts.flowPanel.file.attached");
  const open = async () => {
    setDenied(false);
    try {
      await downloadAttachment(id, name);
    } catch {
      setDenied(true);
    }
  };
  const blocked = q.isError || denied;
  return (
    <span data-testid="file-name">
      {q.data && !q.data.available ? (
        `${name} (${t("contracts.flowPanel.file.removed")})`
      ) : blocked && q.isError ? (
        name
      ) : (
        <button
          type="button"
          className="text-act hover:underline"
          data-testid="file-link"
          onClick={() => void open()}
        >
          <TruncText maxWidth="20rem">{name}</TruncText>
        </button>
      )}
      {blocked && (
        <span role="alert" className="ml-2 text-caption text-late" data-testid="file-denied">
          {t("contracts.flowPanel.file.denied")}
        </span>
      )}
    </span>
  );
}
