// Ô soạn bài (mockup `.composer`): loại bài, trường theo loại, nhóm hàng, ảnh/video, người xem (chủ quản) / ghi chú (đối tác).

import type { AudienceMode, PartnerOrg, PostType } from "@ai/contracts/community";
import { useEffect, useRef, useState } from "react";
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
import { attachFiles } from "../domain/media";
import { defaultAudience } from "../domain/visibility";
import { t } from "../i18n";
import { DraftFields } from "./DraftFields";
import {
  IconAttach,
  IconChevron,
  IconLock,
  IconTypeBuy,
  IconTypeNote,
  IconTypeSell,
  IconX,
} from "./icons";

const TYPE_ICON = { sell: IconTypeSell, buy: IconTypeBuy, note: IconTypeNote } as const;

const typeLabel = (x: PostType): string => t(`community.postType.${x}`);

const MODES: AudienceMode[] = ["all", "suppliers", "buyers", "cats", "companies"];

function AudiencePicker({
  draft,
  set,
  partners,
  cats,
}: {
  draft: Draft;
  set: (d: Draft) => void;
  partners: PartnerOrg[];
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
        <div className="chips">
          {cats.map((c) => (
            <button
              key={c}
              type="button"
              className={aud.cats.includes(c) ? "chip on" : "chip"}
              onClick={() => upd({ cats: toggle(aud.cats, c) })}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      {aud.mode === "companies" && (
        <div className="chips">
          {partners
            .filter((p) => !p.left)
            .map((p) => (
              <button
                key={p.id}
                type="button"
                className={aud.companies.includes(p.id) ? "chip on" : "chip"}
                onClick={() => upd({ companies: toggle(aud.companies, p.id) })}
              >
                {p.name}
              </button>
            ))}
        </div>
      )}
      <div className="audprev" data-testid="audience-preview">
        {audienceError(aud) ?? previewText(recipients)}
      </div>
    </div>
  );
}

export function Composer({ onPosted }: { onPosted?: () => void }) {
  const { api, viewer, isHostViewer, bump, toast } = useApp();
  const [draft, setDraft] = useState<Draft>(emptyDraft("sell"));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [partners, setPartners] = useState<PartnerOrg[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [prefill, setPrefill] = useState("");
  const [busy, setBusy] = useState(false);
  const [audOpen, setAudOpen] = useState(false);
  const [open, setOpenState] = useState<boolean>(() => loadComposerOpen(viewer.userId) ?? false);
  const fileInput = useRef<HTMLInputElement>(null);
  const setOpen = (v: boolean) => {
    setOpenState(v);
    saveComposerOpen(viewer.userId, v);
  };

  useEffect(() => {
    api.listPartners().then(setPartners, () => undefined);
    api.listCats().then(setCats, () => undefined);
  }, [api]);

  const types: PostType[] = isHostViewer
    ? ["sell", "buy", "note"]
    : ([
        viewer.labels.includes("supplier") ? "sell" : null,
        viewer.labels.includes("buyer") ? "buy" : null,
      ].filter(Boolean) as PostType[]);
  useEffect(() => {
    const first = types[0];
    if (first && !types.includes(draft.type)) setDraft(emptyDraft(first));
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
  // Gộp Ảnh + Video thành "Đính kèm": chọn nhiều tệp, loại theo MIME (logic thuần `attachFiles`). Tệp khác chờ route FileBox ở server.
  const attach = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const r = attachFiles(draft.media, Array.from(files), Date.now());
    for (const n of r.notices) toast(t(`community.composer.${n}`));
    setDraft((d) => ({ ...d, media: r.media }));
    if (fileInput.current) fileInput.current.value = "";
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
      <button
        type="button"
        className="iconbtn composer-collapse"
        data-testid="composer-collapse"
        aria-label={t("community.composer.collapse")}
        onClick={() => setOpen(false)}
      >
        <IconChevron size={16} />
      </button>
      {isHostViewer && prefill && (
        <div className="prefill">
          <IconLock size={14} />
          {t("community.composer.prefillBanner", { product: prefill })}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span className="av t1">{initials(viewer.orgName)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
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
          {draft.media.length > 0 && (
            <div className="attachrow">
              {draft.media.map((m) => (
                <span className="attach" key={m.id}>
                  {m.label}
                  <button
                    type="button"
                    aria-label={t("community.composer.removeAttachment")}
                    onClick={() =>
                      setDraft({ ...draft, media: draft.media.filter((x) => x.id !== m.id) })
                    }
                  >
                    <IconX size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {isHostViewer && (
            <div className="selrow" style={{ marginTop: 10, marginBottom: 0 }}>
              <select
                className="field"
                aria-label={t("community.composer.prefillFrom")}
                value={prefill}
                onChange={(e) => {
                  setPrefill(e.target.value);
                  if (e.target.value) setDraft({ ...draft, product: e.target.value });
                }}
              >
                <option value="">{t("community.composer.prefillOption")}</option>
                {DEMO_PRODUCTS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
          )}
          <div className="cbar">
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
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              data-testid="attach-input"
              onChange={(e) => attach(e.target.files)}
            />
            <button
              type="button"
              className="ghost"
              data-testid="attach-btn"
              onClick={() => fileInput.current?.click()}
            >
              <IconAttach size={16} />
              {t("community.composer.attach")}
            </button>
            <div className="sp" />
            {isHostViewer && (
              <button
                type="button"
                className="ghost"
                aria-expanded={audOpen}
                aria-label={t("community.audience.choose")}
                onClick={() => setAudOpen(!audOpen)}
              >
                <IconLock size={13} />
                {audienceSummary(draft.audience, draft.type)}
              </button>
            )}
            {!isHostViewer && (
              <span className="meta" data-testid="partner-note">
                <IconLock size={13} />
                {partnerNote()}
              </span>
            )}
            <button type="button" className="primary" disabled={busy} onClick={publish}>
              {t("community.composer.publish")}
            </button>
          </div>
          {isHostViewer && audOpen && (
            <AudiencePicker draft={draft} set={setDraft} partners={partners} cats={cats} />
          )}
          {errors.audience && <div className="ferr">{errors.audience}</div>}
        </div>
      </div>
    </div>
  );
}
