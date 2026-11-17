// CR-181 · s12 · thân màn ký: trạng thái từng tệp, Lưu chỗ ký (PUT) / Lưu chữ ký (POST), sang tệp kế, hộp thoại.
import type { SignSessionOut } from "@ai/contracts/pack-contracts";
import type { MySignatureView } from "@ai/contracts/signature";
import { toast } from "@ai/web-kit/ui/toast";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CreateSignatureDialog } from "../components/CreateSignatureDialog";
import { ConfirmSignDialog, ReadinessDialog } from "../components/SignDialogs";
import { SignWorkspace } from "../components/SignWorkspace";
import type { SignFile, SignTray } from "../components/types";
import { fetchContent, useDocSign } from "../hooks/use-doc-sign";
import { isStaleVersion, signErrorKey } from "../lib/errors";
import type { PageSize } from "../lib/layout";
import { readAnchors } from "../lib/pdf-anchors";
import {
  buildFieldsPut,
  buildSignBody,
  itemsFromAnchors,
  itemsFromFile,
  openFields,
  readinessLines,
  signFiles,
  signSummary,
} from "../lib/session-map";
import type { SignItem } from "../lib/sign-items";

type Props = {
  id: string;
  session: SignSessionOut;
  mine: MySignatureView | undefined;
  onExit: () => void;
};

export function SignBody({ id, session: s, mine, onExit }: Props) {
  const { t } = useTranslation();
  const q = useDocSign(id);
  const [done, setDone] = useState<string[]>([]);
  const [kind, setKind] = useState<"internal" | "digital">("internal");
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [ready, setReady] = useState<ReturnType<typeof readinessLines> | null>(null);
  const [create, setCreate] = useState(false);
  const [aspect, setAspect] = useState(3);
  const byFile = useRef<Record<string, SignItem[]>>({});
  const mode = s.mode === "prep" ? "prep" : "sign";
  const all = useMemo(() => signFiles(s), [s]);
  const initial = useMemo(() => {
    const o: Record<string, SignItem[]> = {};
    for (const f of all) o[f.file_id] = itemsFromFile(f, mode);
    return o;
  }, [all, mode]);
  const files: SignFile[] = useMemo(
    () =>
      all
        .filter((f) => !done.includes(f.file_id))
        .map((f) => ({
          id: f.file_id,
          name: f.name,
          pageCount: f.pages ?? 0,
          load: () => fetchContent(id, f.file_id, f.latest.version_id),
        })),
    [all, done, id],
  );
  const image = mine?.main?.image;
  useEffect(() => {
    if (mine?.needs_create) setCreate(true);
  }, [mine?.needs_create]);
  useEffect(() => {
    if (!image) return;
    const im = new Image();
    im.onload = () => im.naturalHeight && setAspect(im.naturalWidth / im.naturalHeight);
    im.src = image;
  }, [image]);

  const signers = s.signers;
  const me = signers.find((x) => x.mine)?.name ?? "";
  const trays: SignTray[] = useMemo(() => {
    if (mode === "prep")
      return signers.map((x) => ({
        id: `fld-${x.ref}`,
        type: "field",
        side: x.side,
        person: x.name,
        signerKind: x.kind,
        signerRef: x.ref,
      }));
    return image ? [{ id: "mine", type: "mark", imageUrl: image, aspect }] : [];
  }, [mode, signers, image, aspect]);
  const onChange = useCallback((f: string, items: SignItem[]) => {
    byFile.current[f] = items;
    setDirty(true);
  }, []);
  const list = (f: string) => byFile.current[f] ?? initial[f] ?? [];
  const left = openFields({ ...initial, ...byFile.current });

  const finish = async () => {
    const fresh = await q.session.refetch();
    q.refresh();
    if (mode === "prep" && fresh.data) setReady(readinessLines(fresh.data.readiness));
    else onExit();
  };
  const next = async (f: string) => {
    setDirty(false);
    setDone((d) => [...d, f]);
    if (files.every((x) => x.id === f)) await finish();
  };
  const fail = (e: unknown) => {
    toast(t(signErrorKey(e)), "late");
    if (isStaleVersion(e)) {
      setDirty(false);
      q.refresh(); // có người vừa ký bản mới ⇒ tải lại phiên để ký trên bản mới nhất
    }
  };
  const savePlaces = (f: string) =>
    q.savePlaces.mutate(
      { fileId: f, body: buildFieldsPut(list(f)) },
      {
        onSuccess: () => {
          toast(t("contracts.docsign.placesSaved"));
          void next(f);
        },
        onError: fail,
      },
    );
  const doSign = (f: string) =>
    q.sign.mutate(
      {
        fileId: f,
        body: buildSignBody(list(f), kind, (mine?.settings.caption ?? []).length > 0),
      },
      {
        onSuccess: () => {
          setConfirm(null);
          toast(t("contracts.docsign.signed"));
          void next(f);
        },
        onError: (e) => {
          setConfirm(null);
          fail(e);
        },
      },
    );
  const autoPlace = useCallback(
    async (doc: PDFDocumentProxy, sizes: PageSize[]) =>
      itemsFromAnchors(await readAnchors(doc), signers, sizes),
    [signers],
  );
  const d = s.kinds.digital;
  let saveLabel = t("contracts.docsign.savePlaces");
  if (mode === "sign")
    saveLabel =
      left > 0 ? t("contracts.docsign.saveLeft", { count: left }) : t("contracts.docsign.saveSign");
  return (
    <>
      <SignWorkspace
        files={files}
        mode={mode}
        items={initial}
        trays={trays}
        signatureKinds={[
          { kind: "internal" },
          { kind: "digital", disabledReason: d.enabled ? undefined : d.reason },
        ]}
        kind={kind}
        onKindChange={setKind}
        onChange={onChange}
        onSave={(f) => (mode === "prep" ? savePlaces(f) : setConfirm(f))}
        onFieldClick={() => !image && setCreate(true)}
        signImageUrl={image}
        autoPlace={mode === "prep" ? autoPlace : undefined}
        onClose={onExit}
        saveLabel={saveLabel}
        dirty={dirty}
      />
      <ConfirmSignDialog
        summary={confirm ? signSummary(list(confirm)) : null}
        busy={q.sign.isPending}
        onOk={() => confirm && doSign(confirm)}
        onCancel={() => setConfirm(null)}
      />
      <ReadinessDialog lines={ready} onClose={onExit} />
      {mine && (
        <CreateSignatureDialog
          open={create}
          view={mine}
          person={me}
          onSave={(v) =>
            q.saveSignature.mutate(v, { onSuccess: () => setCreate(false), onError: fail })
          }
          onClose={() => setCreate(false)}
        />
      )}
    </>
  );
}
