// Ô soạn bài (mockup `.composer`): loại bài, trường theo loại, nhóm hàng, ảnh/video, người xem (chủ quản) / ghi chú (đối tác).

import type { AudienceMode, PartnerOrg, PostType } from "@ai/contracts/community";
import { attachPickLabels } from "@ai/web-kit/attach-layout";
import { AttachPickButton } from "@ai/web-kit/ui/AttachDropzone";
import { useEffect, useState } from "react";
import { OptionSelect } from "~/shared/ui/OptionSelect";
import { uploadFiles } from "../application/attach";
import { loadComposerOpen, saveComposerOpen } from "../application/composer-pref";
import { useApp } from "../application/ctx";
import {
  audienceError,
  audienceLabel,
  audienceSummary,
  partnerNote,
  previewRecipients,
  previewText,
} from "../domain/audience";
import { type Draft, draftErrors, emptyDraft, toCreateInput } from "../domain/compose";
import { DEMO_PRODUCTS } from "../domain/demo-products";
import { initials } from "../domain/format";
import { defaultPostType, mentionScope } from "../domain/mention";
import { defaultAudience } from "../domain/visibility";
import { t } from "../i18n";
import { CategoryDialog } from "./CategoryDialog";
import { CompanyPicker } from "./CompanyPicker";
import { DraftAttachments } from "./DraftAttachments";
import { DraftFields } from "./DraftFields";
import { IconChevron, IconLock, IconTypeBuy, IconTypeNote, IconTypeSell } from "./icons";
import { MentionChips, MentionPicker } from "./MentionPicker";

const TYPE_ICON = { sell: IconTypeSell, buy: IconTypeBuy, note: IconTypeNote } as const;

const typeLabel = (x: PostType): string => t(`community.postType.${x}`);

const MODES: AudienceMode[] = ["all", "suppliers", "buyers", "cats", "companies"];

function AudiencePicker({
  draft,
  set,
  partners,
  partnersMore,
  cats,
}: {
  draft: Draft;
  set: (d: Draft) => void;
  partners: PartnerOrg[];
  /** #269: danh sách mới là trang đầu (còn công ty khác) ⇒ xem trước không đếm được đủ. */
  partnersMore: boolean;
  cats: string[];
}) {
  const aud = draft.audience ?? defaultAudience(draft.type);
  const upd = (patch: Partial<typeof aud>) => set({ ...draft, audience: { ...aud, ...patch } });
  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const recipients = previewRecipients(aud, draft.type, draft.cats, partners);
  return (
    <div className="audbox">
      <div className="flabel">{t("community.audience.label")}</div>
      <fieldset className="chips tight" aria-label={t("community.audience.label")}>
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={aud.mode === m ? "chip on" : "chip"}
            aria-pressed={aud.mode === m}
            onClick={() => upd({ mode: m })}
          >
            {audienceLabel(m)}
          </button>
        ))}
      </fieldset>
      {aud.mode === "cats" && (
        <div className="catsel">
          <CategoryDialog cats={cats} value={aud.cats} onChange={(v) => upd({ cats: v })} />
        </div>
      )}
      {aud.mode === "companies" && (
        <CompanyPicker
          selected={aud.companies}
          onToggle={(id) => upd({ companies: toggle(aud.companies, id) })}
        />
      )}
      <div className="audprev" data-testid="audience-preview">
        {audienceError(aud) ??
          (partnersMore
            ? aud.mode === "companies"
              ? audienceSummary(aud, draft.type)
              : t("community.audience.previewPartial")
            : previewText(recipients))}
      </div>
    </div>
  );
}

export function Composer({ onPosted }: { onPosted?: () => void }) {
  const { api, viewer, isHostViewer, bump, toast } = useApp();
  const types: PostType[] = isHostViewer
    ? ["sell", "buy", "note"]
    : ([
        viewer.labels.includes("supplier") ? "sell" : null,
        viewer.labels.includes("customer") ? "buy" : null,
      ].filter(Boolean) as PostType[]);
  // CR-145: chủ quản mặc định «Thông báo»; đối tác ⇒ loại đầu tiên được phép
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(defaultPostType(types)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [partners, setPartners] = useState<PartnerOrg[]>([]);
  const [partnersMore, setPartnersMore] = useState(false);
  const [cats, setCats] = useState<string[]>([]);
  const [prefill, setPrefill] = useState("");
  const [busy, setBusy] = useState(false);
  const [audOpen, setAudOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [open, setOpenState] = useState<boolean>(() => loadComposerOpen(viewer.userId) ?? false);
  const setOpen = (v: boolean) => {
    setOpenState(v);
    saveComposerOpen(viewer.userId, v);
  };

  useEffect(() => {
    api.listPartners({ limit: 50, offset: 0 }).then(
      (r) => {
        setPartners(r);
        setPartnersMore(r.length === 50);
      },
      () => undefined,
    );
    api.listCats().then(setCats, () => undefined);
  }, [api]);

  useEffect(() => {
    if (types.length > 0 && !types.includes(draft.type))
      setDraft(emptyDraft(defaultPostType(types)));
  }, [types, draft.type]);

  const publish = async () => {
    const e = draftErrors(draft);
    const aud = draft.audience ?? defaultAudience(draft.type);
    if (isHostViewer && audienceError(aud)) e.audience = audienceError(aud) as string;
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setBusy(true);
    try {
      await api.createPost(toCreateInput(draft, isHostViewer));
      setDraft(emptyDraft(draft.type));
      setPrefill("");
      setOpen(false);
      toast(t("community.composer.posted"));
      bump();
      onPosted?.();
    } catch (err) {
      toast(err instanceof Error ? err.message : t("community.composer.postFailed"));
    } finally {
      setBusy(false);
    }
  };
  // Gộp Ảnh + Video thành "Đính kèm": MỖI tệp tải lên `POST /pack/community/files` (server quét MIME, cỡ, loại); bài gửi
  // `media:[{id,kind,label,fileId}]`. Quá hạn mức / lỗi upload ⇒ báo Việt hoá (`uploadFiles`).
  const attach = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const r = await uploadFiles(api, files, draft.media);
      for (const n of r.notices)
        toast(t(n.key, n.params) + (n.retry ? ` ${t(n.retry.key, n.retry.params)}` : ""));
      setDraft((d) => ({ ...d, media: r.media }));
    } finally {
      setUploading(false);
    }
  };

  if (!open) {
    return (
      <div className="card pad composer feedcomposer collapsed" data-testid="composer">
        <span className="av t1">{initials(viewer.orgName)}</span>
        <button type="button" className="prompt" onClick={() => setOpen(true)}>
          {t("community.composer.prompt", { org: viewer.orgName })}
        </button>
        <div className="ctypes">
          {types.map((ty) => {
            const Ic = TYPE_ICON[ty];
            return (
              <button
                key={ty}
                type="button"
                className={`ctype ${ty}`}
                data-type={ty}
                aria-label={typeLabel(ty)}
                onClick={() => {
                  setDraft(emptyDraft(ty));
                  setOpen(true);
                }}
              >
                <Ic size={16} />
                <span>{typeLabel(ty)}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="card pad composer feedcomposer" data-testid="composer">
      {isHostViewer && prefill && (
        <div className="prefill">
          <IconLock size={14} />
          {t("community.composer.prefillBanner", { product: prefill })}
        </div>
      )}
      <div className="cmain">
        <span className="av t1">{initials(viewer.orgName)}</span>
        <div className="cbody">
          <div className="ctop">
            <fieldset className="seg" aria-label={t("community.composer.typeLabel")}>
              {types.map((ty) => (
                <button
                  key={ty}
                  type="button"
                  className={draft.type === ty ? "on" : ""}
                  data-type={ty}
                  onClick={() => setDraft({ ...draft, type: ty, audience: undefined })}
                >
                  {typeLabel(ty)}
                </button>
              ))}
            </fieldset>
            {isHostViewer && (
              <OptionSelect
                className="prefillsel"
                aria-label={t("community.composer.prefillFrom")}
                value={prefill}
                onValueChange={(v) => {
                  setPrefill(v);
                  if (v) setDraft({ ...draft, product: v });
                }}
              >
                <option value="">{t("community.composer.prefillOption")}</option>
                {DEMO_PRODUCTS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </OptionSelect>
            )}
            <button
              type="button"
              className="iconbtn composer-collapse"
              data-testid="composer-collapse"
              aria-label={t("community.composer.collapse")}
              onClick={() => setOpen(false)}
            >
              <IconChevron size={16} />
            </button>
          </div>
          <label htmlFor="draft-body" style={{ position: "absolute", left: -9999 }}>
            {t("community.composer.bodyLabel")}
          </label>
          <textarea
            id="draft-body"
            placeholder={t("community.composer.prompt", { org: viewer.orgName })}
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
          {errors.body && <div className="ferr">{errors.body}</div>}
          {draft.type !== "note" && (
            <DraftFields draft={draft} set={setDraft} errors={errors} cats={cats} />
          )}
          <MentionChips
            mentions={draft.mentions}
            onChange={(mentions) => setDraft({ ...draft, mentions })}
          />
          <DraftAttachments
            media={draft.media}
            busy={uploading}
            onChange={(media) => setDraft({ ...draft, media })}
          />
          <div className="cbar">
            <AttachPickButton
              labels={attachPickLabels(t, "community.composer.attachPick")}
              check={false}
              className="ghost icononly"
              testId="attach-btn"
              inputTestId="attach-input"
              disabled={uploading}
              onFiles={(files) => void attach(files)}
            />
            <MentionPicker
              mentions={draft.mentions}
              onChange={(mentions) => setDraft({ ...draft, mentions })}
              scope={mentionScope(draft)}
            />
            {isHostViewer && (
              <button
                type="button"
                className="ghost audbtn"
                aria-expanded={audOpen}
                aria-label={t("community.audience.choose")}
                onClick={() => setAudOpen(!audOpen)}
              >
                <IconLock size={13} />
                <span className="audbtn-txt">{audienceSummary(draft.audience, draft.type)}</span>
              </button>
            )}
            {!isHostViewer && (
              <span className="meta" data-testid="partner-note">
                <IconLock size={13} />
                {partnerNote()}
              </span>
            )}
            <div className="sp" />
            <button type="button" className="primary" disabled={busy} onClick={publish}>
              {t("community.composer.publish")}
            </button>
          </div>
          {isHostViewer && audOpen && (
            <AudiencePicker
              draft={draft}
              set={setDraft}
              partners={partners}
              partnersMore={partnersMore}
              cats={cats}
            />
          )}
          {errors.audience && <div className="ferr">{errors.audience}</div>}
        </div>
      </div>
    </div>
  );
}
