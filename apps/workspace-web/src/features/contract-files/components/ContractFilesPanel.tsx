// CR-133 · khối «Tài liệu kèm» trên trang chi tiết HĐ — MỘT chỗ cho mọi tệp của HĐ ngoài file chính:
// (1) tệp gắn vào HĐ (thêm / gỡ / mở-tải), (2) tệp kèm các bước duyệt (chỉ đọc). Không đem đi ký (file chính vẫn theo luật PDF khi bật ký số).
import type { ContractOwnFile, ContractStepFile } from "@ai/contracts/pack-contracts";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { confirmDialog } from "~/components/shared/dialog-bus";
import { Skeleton } from "~/components/ui/skeleton";
import { ApiError } from "~/lib/api-error";
import {
  isPreviewable,
  openOwnFile,
  openStepFile,
  useContractFiles,
} from "../hooks/use-contract-files";
import { errorKey, sizeLabel, sourceKey } from "../lib/files-view";

const OpenLabel = ({ mime }: { mime: string }) => {
  const { t } = useTranslation();
  return <>{t(isPreviewable(mime) ? "contracts.cfiles.view" : "contracts.cfiles.download")}</>;
};

function OwnRow({
  f,
  onOpen,
  onRemove,
  busy,
}: {
  f: ContractOwnFile;
  onOpen: () => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <li
      data-testid="cfile-row"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
    >
      <span className="min-w-0 flex-1 truncate font-medium" title={f.name}>
        {f.name}
      </span>
      <span className="text-dim tabular-nums">{sizeLabel(f.size)}</span>
      <button type="button" className="btn btn-outline btn-sm" onClick={onOpen}>
        <OpenLabel mime={f.mime} />
      </button>
      {f.can_remove && (
        <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={onRemove}>
          {t("contracts.cfiles.remove")}
        </button>
      )}
    </li>
  );
}

function StepRow({ f, onOpen }: { f: ContractStepFile; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <li
      data-testid="cfile-step-row"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
    >
      <span className="min-w-0 flex-1 truncate font-medium" title={f.name}>
        {f.name}
      </span>
      <span className="text-dim">{t(`contracts.cfiles.source.${sourceKey(f.source)}`)}</span>
      <span className="text-dim tabular-nums">{sizeLabel(f.size)}</span>
      <button type="button" className="btn btn-outline btn-sm" onClick={onOpen}>
        <OpenLabel mime={f.mime} />
      </button>
    </li>
  );
}

export function ContractFilesPanel({ id }: { id: string }) {
  const { t } = useTranslation();
  const { list, add, remove } = useContractFiles(id);
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const data = list.data;
  if (list.isError)
    return (
      <section data-testid="cfiles" className="mb-3 rounded-lg border border-rule bg-panel p-4">
        <h3 className="font-semibold">{t("contracts.cfiles.title")}</h3>
        <p role="alert" className="mt-1 text-sm text-late">
          {t("contracts.cfiles.loadErr")}
        </p>
        <button
          type="button"
          className="btn btn-outline btn-sm mt-2"
          data-testid="cfiles-retry"
          onClick={() => void list.refetch()}
        >
          {t("contracts.cfiles.retry")}
        </button>
      </section>
    );
  if (!data)
    return (
      <section
        data-testid="cfiles-loading"
        aria-busy="true"
        className="mb-3 rounded-lg border border-rule bg-panel p-4"
      >
        <h3 className="font-semibold">{t("contracts.cfiles.title")}</h3>
        <Skeleton className="mt-3 h-5 w-2/3" />
        <Skeleton className="mt-2 h-5 w-1/2" />
      </section>
    );
  const run = (p: Promise<unknown>) => {
    setErr(null);
    p.catch((e) =>
      setErr(t(`contracts.cfiles.err.${errorKey(e instanceof ApiError ? e.code : undefined)}`)),
    );
  };
  const askRemove = async (f: ContractOwnFile) => {
    const ok = await confirmDialog({
      title: t("contracts.cfiles.removeTitle"),
      body: t("contracts.cfiles.removeBody", { name: f.name }),
      confirmLabel: t("contracts.cfiles.remove"),
      danger: true,
    });
    if (ok) run(remove.mutateAsync(f.id));
  };
  const empty = data.files.length === 0 && data.steps.length === 0;
  return (
    <section data-testid="cfiles" className="mb-3 rounded-lg border border-rule bg-panel p-4">
      <div className="flex items-center gap-3">
        <h3 className="flex-1 font-semibold">{t("contracts.cfiles.title")}</h3>
        {data.can_add && (
          <>
            <input
              ref={input}
              type="file"
              hidden
              data-testid="cfiles-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) run(add.mutateAsync(f));
              }}
            />
            <button
              type="button"
              className="btn btn-outline btn-sm"
              data-testid="cfiles-add"
              disabled={add.isPending}
              onClick={() => input.current?.click()}
            >
              {add.isPending ? t("contracts.cfiles.uploading") : t("contracts.cfiles.add")}
            </button>
          </>
        )}
      </div>
      {err && (
        <p role="alert" data-testid="cfiles-error" className="mt-2 text-sm text-late">
          {err}
        </p>
      )}
      {empty && (
        <p className="mt-2 text-sm text-dim" data-testid="cfiles-empty">
          {t(data.can_add ? "contracts.cfiles.empty" : "contracts.cfiles.emptyReadOnly")}
        </p>
      )}
      {data.files.length > 0 && (
        <ul className="mt-2 divide-y divide-rule" data-testid="cfiles-own">
          {data.files.map((f) => (
            <OwnRow
              key={f.id}
              f={f}
              busy={remove.isPending}
              onOpen={() => run(openOwnFile(id, f.id))}
              onRemove={() => void askRemove(f)}
            />
          ))}
        </ul>
      )}
      {data.steps.length > 0 && (
        <>
          <h4 className="mt-3 text-sm font-semibold text-dim">{t("contracts.cfiles.steps")}</h4>
          <ul className="divide-y divide-rule" data-testid="cfiles-steps">
            {data.steps.map((f) => (
              <StepRow key={f.id} f={f} onOpen={() => run(openStepFile(f))} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
