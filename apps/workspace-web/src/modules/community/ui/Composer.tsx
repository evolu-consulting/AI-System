// CR-195 BR-195-2: hộp nền trắng, các phần thẳng trên nền (không thẻ bọc, không thẻ «Ai thấy bài»); điện thoại: ô viết giãn, thanh dưới dính đáy (.composedlg trong mobile.css).
// CR-191 BR-191-5/6/7/8 · đầu bảng tin chỉ MỘT dòng «Viết bài…» (avatar + ô giả) ⇒ hộp thoại (điện thoại toàn màn): loại bài Thông báo / Cần bán /
// Cần mua; Thông báo không có hàng hoá; «Ai thấy bài» (chủ quản); «@» trong THÂN bài nhắc người — người công ty đã kết nối NGOÀI «Ai thấy bài»
// ⇒ hỏi «Thêm <công ty> vào» / «Bỏ nhắc», chưa chọn ⇒ chưa đăng được. Không còn nút «Nhắc tên» riêng.

import type { PostAudience, PostType } from "@ai/contracts/community";
import { attachPickLabels } from "@ai/web-kit/attach-layout";
import { AttachPickButton } from "@ai/web-kit/ui/AttachDropzone";
import { Button } from "@ai/web-kit/ui/kit/button";
import { useEffect, useId, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { uploadFiles } from "../application/attach";
import { useApp } from "../application/ctx";
import { useMentionSuggest } from "../application/useMentionSuggest";
import { addCompany, audienceError, partnerNote } from "../domain/audience";
import { type Draft, draftErrors, emptyDraft, toCreateInput } from "../domain/compose";
import { initials } from "../domain/format";
import {
  type DraftMention,
  defaultPostType,
  mentionScope,
  mentionsInBody,
  stripMention,
  toMention,
} from "../domain/mention";
import { applyMention } from "../domain/thread";
import { t } from "../i18n";
import { ALL_AUDIENCE, AudienceField } from "./AudienceField";
import { DraftAttachments } from "./DraftAttachments";
import { DraftFields } from "./DraftFields";
import { IconLock } from "./icons";
import { MentionChips } from "./MentionChips";
import { MentionSuggest } from "./MentionSuggest";

const typeLabel = (x: PostType): string => t(`community.postType.${x}`);

const allowedTypes = (host: boolean, labels: readonly string[]): PostType[] =>
  host
    ? ["note", "sell", "buy"]
    : ([
        labels.includes("supplier") ? "sell" : null,
        labels.includes("customer") ? "buy" : null,
      ].filter(Boolean) as PostType[]);

/** Hỏi khi nhắc người công ty chưa nằm trong «Ai thấy bài». */
function OutsideAsk({
  m,
  onAdd,
  onDrop,
}: {
  m: DraftMention;
  onAdd: () => void;
  onDrop: () => void;
}) {
  const company = m.orgName ?? "";
  return (
    <div className="cnote" role="alert" data-testid="mention-outside">
      <strong>{t("community.audience.mentionOutsideTitle", { name: m.name })}</strong>{" "}
      {t("community.audience.mentionOutsideBody", { company })}
      <div className="cbar">
        <Button variant="primary" size="sm" data-testid="mention-add-company" onClick={onAdd}>
          {t("community.audience.mentionAdd", { company })}
        </Button>
        <Button variant="quiet" size="sm" data-testid="mention-drop" onClick={onDrop}>
          {t("community.audience.mentionDrop")}
        </Button>
      </div>
    </div>
  );
}

function ComposeBody({
  onPosted,
  onClose,
}: {
  onPosted?: (() => void) | undefined;
  onClose: () => void;
}) {
  const { api, viewer, isHostViewer, bump, toast } = useApp();
  const types = allowedTypes(isHostViewer, viewer.labels);
  const [draft, setDraft] = useState<Draft>(() => ({
    ...emptyDraft(defaultPostType(types)),
    audience: ALL_AUDIENCE,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cats, setCats] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const aud: PostAudience = draft.audience ?? ALL_AUDIENCE;
  const sg = useMentionSuggest(mentionScope({ ...draft, audience: aud }));
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const sugId = useId();

  useEffect(() => {
    api.listCats().then(setCats, () => undefined);
  }, [api]);

  const live = mentionsInBody(draft.body, draft.mentions);
  const pending = live.find((m) => m.outside);

  const publish = async () => {
    const e = draftErrors(draft);
    if (isHostViewer && audienceError(aud)) e.audience = audienceError(aud) as string;
    if (pending) e.mention = t("community.composer.mentionPending");
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setBusy(true);
    try {
      await api.createPost(toCreateInput(draft, isHostViewer));
      toast(t("community.composer.posted"));
      bump();
      onPosted?.();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : t("community.composer.postFailed"));
    } finally {
      setBusy(false);
    }
  };
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
  /** Chọn người ở dòng `i` của danh sách thả «@»: «@chữ» ⇒ «@Tên », thêm chip nhắc (người ngoài «Ai thấy bài» ⇒ hỏi bên dưới). */
  const pick = (i: number) => {
    const p = sg.people[i];
    if (!p || !sg.at) return;
    const r = applyMention(draft.body, sg.at, p.name);
    setDraft((d) => ({
      ...d,
      body: r.text,
      mentions: d.mentions.some((m) => m.userId === p.userId)
        ? d.mentions
        : [...d.mentions, toMention(p)],
    }));
    sg.close();
    requestAnimationFrame(() => {
      bodyRef.current?.focus();
      bodyRef.current?.setSelectionRange(r.caret, r.caret);
    });
  };

  return (
    <div
      data-testid="composer-form"
      className="composer feedcomposer flex min-h-0 flex-1 flex-col gap-4"
    >
      <fieldset className="seg" aria-label={t("community.composer.typeLabel")}>
        {types.map((ty) => (
          <button
            key={ty}
            type="button"
            className={draft.type === ty ? "on" : ""}
            data-type={ty}
            aria-pressed={draft.type === ty}
            onClick={() => setDraft({ ...draft, type: ty })}
          >
            {typeLabel(ty)}
          </button>
        ))}
      </fieldset>
      <label htmlFor="draft-body" style={{ position: "absolute", left: -9999 }}>
        {t("community.composer.bodyLabel")}
      </label>
      <div className="composetext relative">
        <textarea
          ref={bodyRef}
          id="draft-body"
          aria-controls={sg.open ? sugId : undefined}
          placeholder={t("community.composer.bodyPlaceholder")}
          value={draft.body}
          onChange={(e) => {
            setDraft({ ...draft, body: e.target.value });
            sg.update(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onBlur={sg.close}
          onKeyDown={(e) => {
            sg.onKeyDown(e, pick);
          }}
        />
        {sg.open && (
          <MentionSuggest
            id={sugId}
            people={sg.people}
            state={sg.state}
            index={sg.index}
            onHover={sg.setIndex}
            onPick={(p) => pick(sg.people.indexOf(p))}
            placement="below"
          />
        )}
      </div>
      {errors.body && <div className="ferr">{errors.body}</div>}
      {draft.type !== "note" && (
        <DraftFields draft={draft} set={setDraft} errors={errors} cats={cats} />
      )}
      <MentionChips
        mentions={live}
        onChange={(m) =>
          setDraft((d) => ({
            ...d,
            mentions: m,
            body: live
              .filter((x) => !m.some((y) => y.userId === x.userId))
              .reduce((b, x) => stripMention(b, x.name), d.body),
          }))
        }
      />
      {pending && (
        <OutsideAsk
          m={pending}
          onAdd={() => {
            const tenant = pending.tenantId;
            setDraft((d) => ({
              ...d,
              audience: tenant ? addCompany(d.audience ?? ALL_AUDIENCE, tenant) : d.audience,
              mentions: d.mentions.map((x) =>
                x.userId === pending.userId ? { ...x, outside: false } : x,
              ),
            }));
          }}
          onDrop={() =>
            setDraft((d) => ({
              ...d,
              mentions: d.mentions.filter((x) => x.userId !== pending.userId),
              body: stripMention(d.body, pending.name),
            }))
          }
        />
      )}
      {errors.mention && <div className="ferr">{errors.mention}</div>}
      <DraftAttachments
        media={draft.media}
        busy={uploading}
        onChange={(media) => setDraft({ ...draft, media })}
      />
      {isHostViewer ? (
        <AudienceField
          value={aud}
          type={draft.type}
          cats={draft.cats}
          onChange={(a) => setDraft({ ...draft, audience: a })}
        />
      ) : (
        <span className="meta" data-testid="partner-note">
          <IconLock size={13} />
          {partnerNote()}
        </span>
      )}
      {errors.audience && <div className="ferr">{errors.audience}</div>}
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
        <div className="sp" />
        <Button variant="primary" disabled={busy} onClick={publish}>
          {t("community.composer.publish")}
        </Button>
      </div>
    </div>
  );
}

/** Đầu bảng tin: một dòng «Viết bài…» ⇒ hộp thoại soạn bài. `compact`/`onExpand` giữ cho khớp chỗ gọi (không còn dùng: ô luôn một dòng). */
export function Composer({
  onPosted,
}: {
  onPosted?: () => void;
  compact?: boolean;
  onExpand?: () => void;
}) {
  const { viewer, brandAccent } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="card pad composer feedcomposer collapsed" data-testid="composer">
        <span className="av t1">{initials(viewer.orgName)}</span>
        <button
          type="button"
          className="prompt"
          data-testid="composer-open"
          onClick={() => setOpen(true)}
        >
          {t("community.composer.writePost")}
        </button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sm:max-w-[640px] max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-none max-sm:rounded-none max-sm:border-0 max-sm:pb-0"
          aria-describedby={undefined}
        >
          <div
            data-mod="community"
            data-accent={brandAccent}
            data-testid="composer-dialog"
            className="composedlg flex min-h-0 flex-1 flex-col gap-4"
          >
            <DialogHeader>
              <DialogTitle>{t("community.composer.dialogTitle")}</DialogTitle>
            </DialogHeader>
            {open && <ComposeBody onPosted={onPosted} onClose={() => setOpen(false)} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
