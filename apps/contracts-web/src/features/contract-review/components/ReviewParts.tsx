// HD-FR-23 · HD-FR-26 · S05 · D-02: phần phụ của màn kiểm/sửa — cảnh báo (`ContractPage.tsx:120-124`), khối "Không đọc được"
// (`:125-139`), bảng hàng hoá (`:159-171`). Chỉ trình bày.
import type { ContractItem, ContractWarning } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { vnd } from "~/components/shared/format";
import { Panel } from "~/components/shared/layout";

export type FileRef = { href: string; name: string; onOpen: () => void };

/** "📄 Xem file gốc": giữ `<a>` như mgmt-app (khung/ảnh), bấm ⇒ `onOpen` (xin link có Bearer, #220). */
function FileLink({ file, title }: { file: FileRef; title?: string }) {
  const { t } = useTranslation();
  return (
    <a
      href={file.href}
      target="_blank"
      rel="noreferrer"
      className="btn btn-outline"
      title={title}
      onClick={(e) => {
        e.preventDefault();
        file.onOpen();
      }}
    >
      {t("contracts.review.viewFile")}
    </a>
  );
}

/** Nút trên tiêu đề (`ContractPage.tsx:95-109`): "Xem file gốc" + "Lưu" ("Xác nhận" thuộc HD3). */
export function ReviewActions({
  file,
  canSave,
  busy,
  onSave,
}: {
  file: FileRef | null;
  canSave: boolean;
  busy: boolean;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {file && <FileLink file={file} title={file.name} />}
      {canSave && (
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={onSave}>
          {busy ? t("contracts.review.saving") : t("contracts.common.save")}
        </button>
      )}
    </>
  );
}

/** Thông báo sau "Lưu" (`ContractPage.tsx:118-119`). */
export function SaveNotice({ msg, err }: { msg: string | null; err: string | null }) {
  return (
    <>
      {msg && (
        <p role="status" className="mb-3 text-sm text-ok">
          {msg}
        </p>
      )}
      {err && (
        <p role="alert" className="mb-3 text-sm text-late">
          {err}
        </p>
      )}
    </>
  );
}

export function WarningList({ warnings }: { warnings: readonly ContractWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="mb-4 space-y-1 rounded-xl border border-soon-line bg-soon-bg p-4 text-sm text-soon">
      {warnings.map((w, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: cảnh báo không có id, thứ tự cố định theo luật
        <li key={i}>{w.message}</li>
      ))}
    </ul>
  );
}

export function ExtractFailed({ file }: { file: FileRef | null }) {
  const { t } = useTranslation();
  return (
    <Panel className="mb-4 p-5">
      <p className="font-medium text-late">{t("contracts.review.failedTitle")}</p>
      <p className="mt-1 text-sm text-dim">{t("contracts.review.failedBody")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {file && <FileLink file={file} />}

        <Link to="/contracts/new" className="btn btn-primary">
          {t("contracts.review.manual")}
        </Link>
      </div>
    </Panel>
  );
}

export function ItemsTable({ items }: { items: readonly ContractItem[] }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <Panel>
      <table className="w-full text-sm">
        <thead className="bg-sunk text-left text-xs text-dim">
          <tr>
            <th className="px-4 py-2.5">{t("contracts.review.items.name")}</th>
            <th className="px-4">{t("contracts.review.items.unit")}</th>
            <th className="px-4 text-right">{t("contracts.review.items.qty")}</th>
            <th className="px-4 text-right">{t("contracts.review.items.unitPrice")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-t border-rule-soft">
              <td className="px-4 py-2.5">{it.name}</td>
              <td className="px-4">{it.unit ?? ""}</td>
              <td className="px-4 text-right font-mono">{it.qty ?? ""}</td>
              <td className="px-4 text-right font-mono">{vnd(it.unit_price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
