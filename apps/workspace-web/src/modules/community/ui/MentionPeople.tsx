// Ô «Nhắc tên» trong Composer (CR-145): gõ tên (có thể mở đầu bằng @) ⇒ danh sách người nhắc được (server lọc theo người xem bài),
// bấm để thêm; người đã chọn hiện thành chip có nút bỏ. Đối tác / không có ai để nhắc ⇒ nói rõ, không để ô trống khó hiểu.
import type { MentionablePerson } from "@ai/contracts/community";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../application/ctx";
import type { PeopleScope } from "../application/ports";
import { addMention, type DraftMention } from "../domain/mention";
import { t } from "../i18n";
import { IconX } from "./icons";

const label = (p: { name: string; orgName?: string | undefined }) =>
  p.orgName ? `${p.orgName} · ${p.name}` : p.name;

export function MentionPeople({
  mentions,
  onChange,
  scope,
}: {
  mentions: DraftMention[];
  onChange: (m: DraftMention[]) => void;
  scope: PeopleScope;
}) {
  const { api } = useApp();
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<MentionablePerson[]>([]);
  const [focus, setFocus] = useState(false);
  const seq = useRef(0);
  const key = JSON.stringify(scope);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` = phạm vi đã tuần tự hoá
  useEffect(() => {
    if (!focus) return;
    const n = ++seq.current;
    api.mentionablePeople(q.replace(/^@/, "").trim(), scope).then(
      (r) => n === seq.current && setOptions(r),
      () => n === seq.current && setOptions([]),
    );
  }, [api, q, key, focus]);
  const free = options.filter((o) => !mentions.some((m) => m.userId === o.userId));
  return (
    <div className="mentionpeople" data-testid="mention-people">
      <label className="flabel" htmlFor="mention-people-input">
        {t("community.draft.mentionLabel")}
      </label>
      {mentions.length > 0 && (
        <div className="attachrow">
          {mentions.map((m) => (
            <span className="attach" key={m.userId} data-testid="mention-chip">
              {label(m)}
              <button
                type="button"
                aria-label={t("community.draft.mentionRemove", { name: m.name })}
                onClick={() => onChange(mentions.filter((x) => x.userId !== m.userId))}
              >
                <IconX size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        id="mention-people-input"
        className="finput"
        value={q}
        placeholder={t("community.draft.mentionPlaceholder")}
        autoComplete="off"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 150)}
      />
      {focus && (
        <ul className="mentionlist" aria-label={t("community.draft.mentionLabel")}>
          {free.length === 0 && <li className="fhint">{t("community.draft.mentionEmpty")}</li>}
          {free.map((o) => (
            <li key={o.userId}>
              <button
                type="button"
                data-testid="mention-option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(
                    addMention(mentions, {
                      userId: o.userId,
                      name: o.name,
                      ...(o.orgName ? { orgName: o.orgName } : {}),
                    }),
                  );
                  setQ("");
                }}
              >
                {label(o)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
