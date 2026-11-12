// CR-135 · Q5 · các phần của ngăn «Hồ sơ» file: thông tin file · ký số · bằng chứng của bước. Phần «Duyệt» dùng lại `RecordBody` (một nguồn).
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { viDateTime } from "~/components/shared/format";
import { TruncText } from "~/components/shared/TruncText";
import { Btn } from "~/components/ui/Btn";
import { mimeKind, type SignBlock } from "../lib/file-record";

export function Section({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section data-testid={testId} className="border-b border-rule-soft py-4 last:border-b-0">
      <h3 className="m-0 mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export type InfoRow = { key: string; value: ReactNode };

export function FileInfo({ rows }: { rows: InfoRow[] }) {
  const { t } = useTranslation();
  return (
    <dl className="m-0 grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1 text-sm">
      {rows.map((r) => (
        <div key={r.key} className="contents">
          <dt className="text-dim">{t(`contracts.frec.info.${r.key}`)}</dt>
          <dd className="m-0 min-w-0">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const kindLabel = (t: (k: string) => string, mime: string): string =>
  t(`contracts.frec.kind.${mimeKind(mime)}`);

export function SignInfo({
  b,
  main,
  onDownload,
  busy,
}: {
  b: SignBlock;
  main: boolean;
  onDownload: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="text-sm" data-testid="frec-sign" data-mode={b.mode}>
      {!main && <p className="m-0 mb-2 text-dim">{t("contracts.frec.sign.attachNote")}</p>}
      {b.mode === "none" && <p className="m-0">{t("contracts.frec.sign.none")}</p>}
      {b.mode === "notSent" && <p className="m-0">{t("contracts.frec.sign.notSent")}</p>}
      {b.mode === "envelope" && (
        <>
          <p className="m-0 flex flex-wrap items-center gap-x-2">
            <b>{t(b.statusKey)}</b>
            {b.completedAt && <span className="text-dim">{viDateTime(b.completedAt)}</span>}
            <span className="text-dim">· {b.provider}</span>
            {b.demo && <span className="text-soon">{t("contracts.esign.demo")}</span>}
          </p>
          {b.reason && <p className="m-0 mt-1 text-dim">“{b.reason}”</p>}
          <ol className="m-0 mt-2 list-none p-0">
            {b.signers.map((s) => (
              <li
                key={s.order}
                data-testid="frec-signer"
                className="flex flex-wrap gap-x-2 border-b border-rule-soft py-1.5 last:border-b-0"
              >
                <b>{s.name}</b>
                <span className="text-dim">({t(s.roleKey)})</span>
                <span>· {t(s.labelKey)}</span>
                {s.at && <span className="text-dim">{viDateTime(s.at)}</span>}
              </li>
            ))}
          </ol>
          {b.hasSignedFile && (
            <Btn
              size="sm"
              variant="outline"
              className="mt-2"
              data-testid="frec-signed-download"
              loading={busy}
              onClick={onDownload}
            >
              {t("contracts.frec.sign.download")}
            </Btn>
          )}
        </>
      )}
    </div>
  );
}

export function EvidenceOf({ steps }: { steps: string[] }) {
  const { t } = useTranslation();
  return (
    <p className="m-0 mt-3 text-sm" data-testid="frec-evidence">
      {steps.length > 0 ? (
        <>
          {t("contracts.frec.evidence.of")}{" "}
          {steps.map((s, i) => (
            <span key={s}>
              {i > 0 ? ", " : ""}
              <b>
                <TruncText maxWidth="14rem">{s}</TruncText>
              </b>
            </span>
          ))}
        </>
      ) : (
        t("contracts.frec.evidence.none")
      )}
    </p>
  );
}
