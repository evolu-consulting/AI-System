// CR-188 · BR-188-6 · thân «Kiểm tra tệp» dùng chung cho hộp thoại (nút trên danh sách HĐ, «⋯» từng HĐ) và trang `/contracts/verify`.
import { Button } from "@ai/web-kit/ui/kit/button";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { viDateTime } from "~/components/shared/format";
import { useMemberNames } from "~/features/contract-review/hooks/use-manage";
import { type VerifyResult, verifyFile } from "./api";

export type VerifyFrom = { id: string; title: string };

function Result({ r, from }: { r: VerifyResult; from?: VerifyFrom | undefined }) {
  const { t } = useTranslation();
  const nameOf = useMemberNames();
  if (!r.match)
    return (
      <p data-testid="verify-miss" className="text-sm text-danger">
        {t("contracts.verify.miss")}
      </p>
    );
  const c = r.contract;
  if (!r.visible || !c)
    return (
      <p data-testid="verify-hidden" className="text-sm font-medium text-ok">
        {t("contracts.verify.hidden")}
      </p>
    );
  const who = nameOf(r.signed_by) ?? t("contracts.verify.someone");
  const kind = t(`contracts.verify.kind.${c.kind}`);
  return (
    <div data-testid="verify-hit" className="text-sm">
      {r.other && from && (
        <p data-testid="verify-other" className="mb-1 font-medium text-late">
          {t("contracts.verify.other", { title: c.title })}
        </p>
      )}
      <p className="font-medium text-ok">{t("contracts.verify.hit", { kind, title: c.title })}</p>
      <ul className="mt-1 text-dim">
        {c.partner && <li>{t("contracts.verify.partner", { name: c.partner })}</li>}
        <li>
          {t("contracts.verify.signedAt", {
            name: who,
            at: r.signed_at ? viDateTime(r.signed_at) : "",
          })}
        </li>
        <li>{t("contracts.verify.code", { code: r.check_code })}</li>
      </ul>
      <Link
        to="/contracts/c/$id"
        params={{ id: c.id }}
        className="mt-2 inline-block font-medium text-act hover:underline"
      >
        {t("contracts.verify.openContract")}
      </Link>
    </div>
  );
}

export function VerifyFilePanel({ from }: { from?: VerifyFrom | undefined }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const m = useMutation({ mutationFn: (f: File) => verifyFile(f, from?.id) });
  const run = (f: File | undefined) => {
    if (!f) return;
    setName(f.name);
    m.mutate(f);
  };
  return (
    <div>
      <p className="mb-3 text-sm text-dim">{t("contracts.verify.intro")}</p>
      {from && (
        <p data-testid="verify-from" className="mb-3 text-sm text-dim">
          {t("contracts.verify.from", { title: from.title })}
        </p>
      )}
      <input
        ref={ref}
        type="file"
        hidden
        data-testid="verify-file"
        onChange={(e) => {
          run(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <section
        aria-label={t("contracts.verify.drop")}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          run(e.dataTransfer.files[0]);
        }}
        className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 text-center ${over ? "border-primary bg-accent" : "border-input"}`}
      >
        <p className="text-sm text-dim">{name ?? t("contracts.verify.drop")}</p>
        <Button variant="outline" busy={m.isPending} onClick={() => ref.current?.click()}>
          {t("contracts.verify.pick")}
        </Button>
      </section>
      <div className="mt-4" aria-live="polite">
        {m.data && <Result r={m.data} from={from} />}
        {m.isError && (
          <p role="alert" className="text-sm text-danger">
            {t("contracts.verify.error")}
          </p>
        )}
      </div>
    </div>
  );
}
