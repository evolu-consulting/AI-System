// Ô soạn bài (mockup `.composer`): loại bài, trường theo loại, nhóm hàng, ảnh/video, người xem (chủ quản) / ghi chú (đối tác).

import type { PartnerOrg } from "@ai/contracts/community";
import { type AudienceMode, POST_TYPE_LABEL, type PostType } from "@ai/contracts/community";
import { useEffect, useState } from "react";
import {
  AUDIENCE_LABEL,
  audienceError,
  audienceSummary,
  PARTNER_NOTE,
  previewRecipients,
  previewText,
} from "../lib/audience";
import { canAddMedia, type Draft, draftErrors, emptyDraft, toCreateInput } from "../lib/compose";
import { DEMO_PRODUCTS } from "../lib/demo-products";
import { initials } from "../lib/format";
import { defaultAudience } from "../lib/visibility";
import { useApp } from "./ctx";
import { DraftFields } from "./DraftFields";
import { IconImage, IconLock, IconVideo, IconX } from "./icons";

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
      <div className="flabel">Người xem</div>
      <fieldset className="chips tight" aria-label="Người xem">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={aud.mode === m ? "chip on" : "chip"}
            aria-pressed={aud.mode === m}
            onClick={() => upd({ mode: m })}
          >
            {AUDIENCE_LABEL[m]}
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
      toast("Đã đăng bài");
      bump();
      onPosted?.();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Không đăng được");
    } finally {
      setBusy(false);
    }
  };
  const addMedia = (kind: "image" | "video") => {
    if (!canAddMedia(draft.media, kind))
      return toast(kind === "image" ? "Tối đa 10 ảnh" : "Tối đa 2 video");
    const n = draft.media.filter((m) => m.kind === kind).length + 1;
    setDraft({
      ...draft,
      media: [
        ...draft.media,
        {
          id: `${kind}-${Date.now()}-${n}`,
          kind,
          label: `${kind === "image" ? "Ảnh" : "Video"} ${n}`,
        },
      ],
    });
  };

  return (
    <div className="card pad composer" data-testid="composer">
      {isHostViewer && prefill && (
        <div className="prefill">
          <IconLock size={14} />
          Điền sẵn từ Sổ Hợp Tác · {prefill}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span className="av t1">{initials(viewer.orgName)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <label htmlFor="draft-body" style={{ position: "absolute", left: -9999 }}>
            Nội dung bài đăng
          </label>
          <textarea
            id="draft-body"
            placeholder={`${viewer.orgName} đang có hàng cần bán hay nhu cầu cần mua?`}
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
                    aria-label="Bỏ tệp đính kèm"
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
                aria-label="Điền sẵn từ Sổ Hợp Tác"
                value={prefill}
                onChange={(e) => {
                  setPrefill(e.target.value);
                  if (e.target.value) setDraft({ ...draft, product: e.target.value });
                }}
              >
                <option value="">Điền sẵn từ Sổ Hợp Tác…</option>
                {DEMO_PRODUCTS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
          )}
          <div className="cbar">
            <fieldset className="seg" aria-label="Loại bài">
              {types.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={draft.type === t ? "on" : ""}
                  onClick={() => setDraft({ ...draft, type: t, audience: undefined })}
                >
                  {POST_TYPE_LABEL[t]}
                </button>
              ))}
            </fieldset>
            <button type="button" className="ghost" onClick={() => addMedia("image")}>
              <IconImage size={16} />
              Ảnh
            </button>
            <button type="button" className="ghost" onClick={() => addMedia("video")}>
              <IconVideo size={16} />
              Video
            </button>
            <div className="sp" />
            {isHostViewer && (
              <button
                type="button"
                className="ghost"
                aria-expanded={audOpen}
                aria-label="Chọn người xem"
                onClick={() => setAudOpen(!audOpen)}
              >
                <IconLock size={13} />
                {audienceSummary(draft.audience, draft.type)}
              </button>
            )}
            {!isHostViewer && (
              <span className="meta" data-testid="partner-note">
                <IconLock size={13} />
                {PARTNER_NOTE}
              </span>
            )}
            <button type="button" className="primary" disabled={busy} onClick={publish}>
              Đăng bài
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
