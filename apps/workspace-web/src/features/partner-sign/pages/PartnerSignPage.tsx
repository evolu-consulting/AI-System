// CR-182 · trang công khai `/ky/$token`: mời ký → (lần đầu) tạo chữ ký nhanh → màn ký → «Đã ký xong». Không gọi API cần đăng nhập.
import { toast } from "@ai/web-kit/ui/toast";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DeclineDialog } from "../components/DeclineDialog";
import { PartnerInvite } from "../components/PartnerInvite";
import { PartnerShell } from "../components/PartnerShell";
import { PartnerSignBody } from "../components/PartnerSignBody";
import { DeclinedState, ProblemState, SignedState } from "../components/PartnerStates";
import { QuickSignatureDialog } from "../components/QuickSignatureDialog";
import { usePartnerLink } from "../hooks/use-partner-link";
import { filesToSign, pageState, partnerErrorKey } from "../lib/partner-map";
import type { PartnerSignPort } from "../ports";

export function PartnerSignPage({ token, port }: { token: string; port?: PartnerSignPort }) {
  const { t } = useTranslation();
  const l = usePartnerLink(token, port);
  const [signing, setSigning] = useState(false);
  const [quick, setQuick] = useState(false);
  const [decl, setDecl] = useState(false);
  const v = l.view.data;
  const state = pageState(v, l.view.error as { status: number } | null);

  if (l.view.isPending)
    return (
      <PartnerShell>
        <p role="status" className="m-0 text-md text-muted-foreground">
          {t("contracts.psign.loading")}
        </p>
      </PartnerShell>
    );
  if (!v)
    return (
      <PartnerShell>
        <ProblemState
          kind={state === "gone" || state === "notfound" || state === "limit" ? state : "error"}
          onRetry={() => void l.view.refetch()}
        />
      </PartnerShell>
    );

  const start = () => (l.image ? setSigning(true) : setQuick(true));
  const fail = (e: unknown) => toast(t(partnerErrorKey(e)), "late");
  if (signing && l.image && state === "invite")
    return (
      <PartnerSignBody
        files={filesToSign(v.files)}
        person={v.contact_name}
        image={l.image}
        load={l.port.content}
        onSign={(b) => l.sign.mutateAsync(b)}
        busy={l.sign.isPending}
        onExit={() => {
          setSigning(false);
          void l.refresh();
        }}
        onStale={() => void l.refresh()}
      />
    );
  return (
    <PartnerShell company={v.company_name}>
      {state === "invite" && (
        <PartnerInvite view={v} onSign={start} onDecline={() => setDecl(true)} />
      )}
      {state === "signed" && <SignedState view={v} signedUrl={l.port.signedUrl} />}
      {state === "declined" && <DeclinedState view={v} />}
      <QuickSignatureDialog
        open={quick}
        name={v.contact_name}
        onClose={() => setQuick(false)}
        onSave={(png, method) =>
          l.quick.mutate(
            { png, method },
            {
              onSuccess: () => {
                setQuick(false);
                setSigning(true);
              },
              onError: fail,
            },
          )
        }
      />
      <DeclineDialog
        open={decl}
        company={v.company_name}
        busy={l.decline.isPending}
        onClose={() => setDecl(false)}
        onOk={(reason) =>
          l.decline.mutate(reason, {
            onSuccess: () => {
              setDecl(false);
              toast(t("contracts.psign.decl.done"));
            },
            onError: (e) => {
              setDecl(false);
              fail(e);
            },
          })
        }
      />
    </PartnerShell>
  );
}
