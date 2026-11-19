// CR-181 · s4 · `/my-signature` «Chữ ký của tôi» (khu tài khoản). Tạo mới trong hộp thoại; khoá khi phải quản trị cho phép.
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ai/web-kit/ui/kit/dialog";
import { Skeleton } from "@ai/web-kit/ui/kit/skeleton";
import { toast } from "@ai/web-kit/ui/toast";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "~/features/auth/hooks/use-session";
import type { SigDocsFilter } from "../api";
import { CreateFlow } from "../components/CreateFlow";
import { MySignatureCards } from "../components/MySignatureCards";
import { SignedDocsPanel } from "../components/SignedDocsPanel";
import {
  useCreateSignature,
  useMySignature,
  useRequestChange,
  useSigDocs,
} from "../hooks/use-my-signature";

export default function MySignaturePage() {
  const { t } = useTranslation();
  const me = useSession((s) => s.me);
  const q = useMySignature();
  const create = useCreateSignature();
  const ask = useRequestChange();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [filter, setFilter] = useState<SigDocsFilter>({ kind: "", from: "", to: "" });
  const docs = useSigDocs(picked, filter);
  const name = me?.display_name || me?.username || "";
  const request = () =>
    ask.mutate(undefined, {
      onSuccess: () => toast(t("contracts.mySig.page.requestSent"), "ok"),
      onError: () => toast(t("contracts.mySig.page.requestFail"), "late"),
    });
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <h1 className="text-xl font-semibold">{t("contracts.mySig.page.title")}</h1>
        <p className="text-muted-foreground">{t("contracts.mySig.page.lead")}</p>
      </div>
      {q.isPending && <Skeleton className="h-48 w-full" />}
      {q.isError && (
        <p role="alert" className="text-danger">
          {t("contracts.mySig.page.loadErr")}
        </p>
      )}
      {q.data && (
        <>
          <MySignatureCards
            view={q.data}
            onCreate={() => setOpen(true)}
            onRequest={request}
            requesting={ask.isPending}
            selectedId={picked}
            onSelect={setPicked}
          />
          {picked && (
            <SignedDocsPanel
              filter={filter}
              onFilter={setFilter}
              items={docs.data?.pages.flatMap((pg) => pg.items) ?? []}
              loading={docs.isPending}
              error={docs.isError}
              hasMore={docs.hasNextPage}
              loadingMore={docs.isFetchingNextPage}
              onMore={() => docs.fetchNextPage()}
            />
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent
              closeLabel={t("contracts.mySig.page.close")}
              className="max-h-dvh overflow-y-auto sm:max-w-xl"
            >
              <DialogHeader>
                <DialogTitle>{t("contracts.mySig.page.create")}</DialogTitle>
                <DialogDescription>{t("contracts.mySig.page.dlgDesc")}</DialogDescription>
              </DialogHeader>
              <DialogBody>
                <CreateFlow
                  view={{ ...q.data, main: null }}
                  person={{ name }}
                  save={(kind, png, method, caption) =>
                    create.mutateAsync({ kind, method, png, caption })
                  }
                  onDone={() => {
                    setOpen(false);
                    toast(t("contracts.mySig.gate.saved"), "ok");
                  }}
                  onFail={() => toast(t("contracts.mySig.gate.saveFail"), "late")}
                />
              </DialogBody>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
