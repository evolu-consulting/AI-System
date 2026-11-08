// CR-125 · cr125-manual-start-ui · MỘT ô của phiếu yêu cầu theo loại (chữ ngắn/dài, tiền, ngày, người, phòng ban, tệp đính kèm).
// Tệp: tải bằng đường tải tệp sẵn có (`POST /attachments`) ngay khi chọn, giá trị ô = danh sách id tệp.

import { DateInput } from "@ai/web-kit/ui/DateInput";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { uploadAttachment } from "../api";
import { useOrgOptions } from "../hooks/use-org-options";
import type { RField, RValue } from "../lib/request-form";

type Props = {
  field: RField;
  value: RValue;
  error: string | undefined;
  onChange: (v: RValue) => void;
};

type Picked = { id: string; name: string };

function Files({ field, value, onChange }: Pick<Props, "field" | "value" | "onChange">) {
  const { t } = useTranslation();
  const [names, setNames] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const ids = value as string[];
  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    setErr(false);
    try {
      const up: Picked[] = [];
      for (const file of Array.from(list))
        up.push({ id: (await uploadAttachment(file)).id, name: file.name });
      setNames((n) => [...n, ...up]);
      onChange([...ids, ...up.map((u) => u.id)]);
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <input
        id={`req-${field.key}`}
        data-testid={`req-file-${field.key}`}
        type="file"
        multiple
        disabled={busy}
        aria-label={field.label}
        onChange={(e) => {
          void add(e.target.files);
          e.target.value = "";
        }}
      />
      {busy && <span className="text-label text-dim">{t("contracts.requests.uploading")}</span>}
      {err && (
        <span role="alert" className="text-label text-late">
          {t("contracts.requests.err.generic")}
        </span>
      )}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {ids.map((id) => {
          const name = names.find((n) => n.id === id)?.name ?? id;
          return (
            <li key={id} className="flex items-center gap-2 text-sm" data-testid="req-file-item">
              <span className="min-w-0 truncate">{name}</span>
              <button
                type="button"
                className="text-label text-act hover:underline"
                aria-label={t("contracts.requests.removeFile", { name })}
                onClick={() => onChange(ids.filter((x) => x !== id))}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function OrgSelect({ field, value, onChange }: Pick<Props, "field" | "value" | "onChange">) {
  const { t } = useTranslation();
  const org = useOrgOptions(true);
  const people = field.type === "people";
  const options = people ? org.people : org.departments;
  const cur = people ? ((value as string[])[0] ?? "") : (value as string);
  return (
    <>
      <select
        id={`req-${field.key}`}
        className="h-9 w-full rounded-md border border-rule bg-panel px-2 text-sm"
        value={cur}
        onChange={(e) =>
          onChange(people ? (e.target.value ? [e.target.value] : []) : e.target.value)
        }
      >
        <option value="">
          {t(people ? "contracts.requests.pickPerson" : "contracts.requests.pickDept")}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {org.failed && <span className="text-label text-dim">{t("contracts.requests.noOrg")}</span>}
    </>
  );
}

export function RequestField({ field, value, error, onChange }: Props) {
  const { t } = useTranslation();
  const id = `req-${field.key}`;
  const control = (() => {
    switch (field.type) {
      case "longtext":
        return (
          <textarea
            id={id}
            rows={4}
            className="w-full rounded-md border border-rule bg-panel px-3 py-2 text-sm"
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
          />
        );
      case "money":
        return (
          <div className="flex items-center gap-2">
            <Input
              id={id}
              type="number"
              inputMode="decimal"
              min={0}
              value={value as string}
              onChange={(e) => onChange(e.target.value)}
            />
            <span className="text-sm text-dim">{t("contracts.requests.moneyUnit")}</span>
          </div>
        );
      case "date":
        return (
          <DateInput id={id} value={value as string} onChange={(e) => onChange(e.target.value)} />
        );
      case "people":
      case "department":
        return <OrgSelect field={field} value={value} onChange={onChange} />;
      case "attachments":
        return <Files field={field} value={value} onChange={onChange} />;
      default:
        return <Input id={id} value={value as string} onChange={(e) => onChange(e.target.value)} />;
    }
  })();
  return (
    <div className="flex flex-col gap-1.5" data-testid={`req-field-${field.key}`}>
      <Label htmlFor={id}>
        {field.label}
        {field.required && (
          <span className="ml-1 text-label text-dim">{t("contracts.requests.required")}</span>
        )}
      </Label>
      {control}
      {field.help && <span className="text-label text-dim">{field.help}</span>}
      {error && (
        <span role="alert" className="text-label text-late" data-testid="req-field-error">
          {t(`contracts.requests.err.${error}`)}
        </span>
      )}
    </div>
  );
}
