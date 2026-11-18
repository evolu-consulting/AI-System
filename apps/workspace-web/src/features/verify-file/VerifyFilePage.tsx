// CR-182 · R7 · «Kiểm tra tệp» (/contracts/verify): chọn/kéo thả một tệp ⇒ máy chủ so dấu vân tay với bản đã lưu của công ty (không lưu tệp).
import { Button } from "@ai/web-kit/ui/kit/button";
import { PageHeader } from "@ai/web-kit/ui/kit/page-header";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { viDateTime } from "~/components/shared/format";
import { Panel } from "~/components/shared/layout";
import { useMemberNames } from "~/features/contract-review/hooks/use-manage";
import { type VerifyResult, verifyFile } from "./api";

function Result({ r }: { r: VerifyResult }) {
  const { t } = useTranslation();
  const nameOf = useMemberNames();
  if (!r.match)
    return (
      <p data-testid="verify-miss" className="text-sm text-danger">
        {t("contracts.verify.miss")}
      </p>
    );
  const who = nameOf(r.signed_by) ?? t("contracts.verify.someone");
  const which =
    r.which === "signed"
      ? t("contracts.verify.afterSign", { name: who })
      : t("contracts.verify.original");
  return (
    <div data-testid="verify-hit" className="text-sm">
      <p className="font-medium text-ok">
        {t("contracts.verify.hit", { which, title: r.contract.title, code: r.check_code })}
        {r.signed_at ? ` · ${t("contracts.verify.at", { at: viDateTime(r.signed_at) })}` : ""}
      </p>
      {r.which === "signed" && r.file_id ? (
        <Link
          to="/contracts/signed/$id"
          params={{ id: r.contract.id }}
          search={{ file: r.file_id, v: r.version_id ?? undefined }}
          className="mt-2 inline-block font-medium text-act hover:underline"
        >
          {t("contracts.verify.open")}
        </Link>
      ) : (
        <Link
          to="/contracts/c/$id"
          params={{ id: r.contract.id }}
          className="mt-2 inline-block font-medium text-act hover:underline"
        >
          {t("contracts.verify.openContract")}
        </Link>
      )}
    </div>
  );
}

export function VerifyFilePage() {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const m = useMutation({ mutationFn: verifyFile });
  const run = (f: File | undefined) => {
    if (!f) return;
    setName(f.name);
    m.mutate(f);
  };
  return (
    <div data-testid="verify-page">
      <PageHeader className="mb-5" title={t("contracts.verify.title")} />
      <Panel className="p-5">
        <p className="mb-3 text-sm text-dim">{t("contracts.verify.intro")}</p>
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
          {m.data && <Result r={m.data} />}
          {m.isError && (
            <p role="alert" className="text-sm text-danger">
              {t("contracts.verify.error")}
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}
