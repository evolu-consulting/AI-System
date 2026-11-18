// CR-182 · màn ký của đối tác: dùng lại SignWorkspace (chế độ ký). Dữ liệu vào bằng props (từ cổng link), Lưu chỉ gửi vị trí (BR-K3).
import type { PartnerSignFileOut, PartnerSignSaveOut } from "@ai/contracts/pack-contracts";
import { toast } from "@ai/web-kit/ui/toast";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmSignDialog } from "~/features/doc-sign/components/SignDialogs";
import { SignWorkspace } from "~/features/doc-sign/components/SignWorkspace";
import type { SignFile, SignTray } from "~/features/doc-sign/components/types";
import { openFields, signSummary } from "~/features/doc-sign/lib/session-map";
import type { SignItem } from "~/features/doc-sign/lib/sign-items";
import { partnerErrorKey, partnerItems, partnerSignBody } from "../lib/partner-map";

const KINDS = [{ kind: "internal" as const }];
const noop = () => undefined;

type Props = {
  files: PartnerSignFileOut[];
  person: string;
  /** Ảnh chữ ký nhanh (xanh) của đối tác: khay + ô. */
  image: string;
  load: (fileId: string, versionId: string | null) => Promise<ArrayBuffer>;
  onSign: (body: NonNullable<ReturnType<typeof partnerSignBody>>) => Promise<PartnerSignSaveOut>;
  busy: boolean;
  /** Đã Lưu hết các tệp (hoặc bấm Quay lại): về trang mời ký, tải lại trạng thái. */
  onExit: () => void;
  /** Lỗi bản cũ (409 SIGN_VERSION_STALE) ⇒ tải lại để ký trên bản mới. */
  onStale: () => void;
};

export function PartnerSignBody({
  files,
  person,
  image,
  load,
  onSign,
  busy,
  onExit,
  onStale,
}: Props) {
  const { t } = useTranslation();
  const [done, setDone] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [aspect, setAspect] = useState(3);
  const [byFile, setByFile] = useState<Record<string, SignItem[]>>({});
  const initial = useMemo(() => {
    const o: Record<string, SignItem[]> = {};
    for (const f of files) o[f.file_id] = partnerItems(f, person);
    return o;
  }, [files, person]);
  const shown: SignFile[] = useMemo(
    () =>
      files
        .filter((f) => !done.includes(f.file_id))
        .map((f) => ({
          id: f.file_id,
          name: f.name,
          pageCount: f.pages ?? 0,
          load: () => load(f.file_id, f.latest_version_id),
        })),
    [files, done, load],
  );
  useEffect(() => {
    const im = new Image();
    im.onload = () => im.naturalHeight && setAspect(im.naturalWidth / im.naturalHeight);
    im.src = image;
  }, [image]);
  const trays: SignTray[] = useMemo(
    () => [{ id: "mine", type: "mark", imageUrl: image, aspect }],
    [image, aspect],
  );
  const onChange = useCallback((f: string, items: SignItem[]) => {
    setByFile((cur) => ({ ...cur, [f]: items }));
    setDirty(true);
  }, []);
  const items = useMemo(() => ({ ...initial, ...byFile }), [initial, byFile]);
  const list = (f: string) => items[f] ?? [];
  const left = openFields(items);

  const doSign = async (f: string) => {
    const body = partnerSignBody(f, list(f));
    if (!body) return setConfirm(null);
    try {
      await onSign(body);
      setConfirm(null);
      toast(t("contracts.psign.sign.saved"));
      setDirty(false);
      setDone((d) => [...d, f]);
      if (shown.every((x) => x.id === f)) onExit();
    } catch (e) {
      setConfirm(null);
      toast(t(partnerErrorKey(e)), "late");
      if ((e as { code?: string } | null)?.code === "SIGN_VERSION_STALE") {
        setDirty(false);
        onStale();
      }
    }
  };
  const saveLabel =
    left > 0 ? t("contracts.psign.sign.saveLeft", { count: left }) : t("contracts.psign.sign.save");
  // Điện thoại ≤ 640px: «Lưu · còn n» (cùng nhãn gọn với màn ký công ty).
  const saveShort = left > 0 ? t("contracts.docsign.saveLeftShort", { count: left }) : undefined;
  return (
    <>
      <SignWorkspace
        files={shown}
        mode="sign"
        items={items}
        saveDisabled={(f) => partnerSignBody(f, list(f)) === null}
        trays={trays}
        signatureKinds={KINDS}
        kind="internal"
        onKindChange={noop}
        onChange={onChange}
        onSave={setConfirm}
        signImageUrl={image}
        onClose={onExit}
        saveLabel={saveLabel}
        saveShort={saveShort}
        dirty={dirty}
      />
      <ConfirmSignDialog
        summary={confirm ? signSummary(list(confirm)) : null}
        busy={busy}
        onOk={() => confirm && void doSign(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
