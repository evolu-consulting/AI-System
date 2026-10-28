// Bình luận riêng theo (bài × công ty) (D3): chủ quản có tab theo công ty + "Nhắn riêng"; đối tác chỉ thấy luồng của mình.
import type {
  CommentView,
  PartnerOrg,
  PostView,
  ThreadSummary,
  Thread as ThreadT,
} from "@ai/contracts/community";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { initials } from "../lib/format";
import { commentActions, startablePartners } from "../lib/thread";
import { CommentItem } from "./CommentItem";
import { useApp } from "./ctx";
import { IconLock, IconSend } from "./icons";

/** `extra`: nút việc gắn thêm trên từng bình luận (vd Lưu báo giá của NCC, C7b) — vào slot `action` của CommentItem. */
export function Thread({
  post,
  onChanged,
  extra,
}: {
  post: PostView;
  onChanged: () => void;
  extra?: (c: CommentView) => ReactNode;
}) {
  const { api, viewer, isHostViewer, rev } = useApp();
  const [tabs, setTabs] = useState<ThreadSummary[]>([]);
  const [partners, setPartners] = useState<PartnerOrg[]>([]);
  const [active, setActive] = useState<string>("");
  const [thread, setThread] = useState<ThreadT | null>(null);
  const [text, setText] = useState("");

  const load = useCallback(
    async (org?: string) => {
      const list = await api.listThreads(post.id);
      setTabs(list);
      if (isHostViewer) setPartners(await api.listPartners());
      const cur = org ?? (list.some((t) => t.orgId === active) ? active : (list[0]?.orgId ?? ""));
      setActive(cur);
      setThread(
        cur && list.some((t) => t.orgId === cur) ? await api.getThread(post.id, cur) : null,
      );
    },
    [api, post.id, active, isHostViewer],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại khi dữ liệu đổi (rev)
  useEffect(() => {
    load().catch(() => undefined);
  }, [rev]);

  const send = async () => {
    if (!text.trim()) return;
    await api.addComment(post.id, { text, ...(isHostViewer && active ? { orgId: active } : {}) });
    setText("");
    await load(active);
    onChanged();
  };
  const mutate = async (p: Promise<ThreadT>) => {
    setThread(await p);
    await load(active);
    onChanged();
  };
  const note = isHostViewer
    ? "Mỗi đối tác một luồng riêng: đối tác chỉ thấy trao đổi của chính họ với bạn."
    : "Chỉ chủ quản thấy trao đổi này.";
  const canWrite = !isHostViewer || Boolean(active);
  const startable = isHostViewer ? startablePartners(post, partners, tabs) : [];
  const pending = isHostViewer && active !== "" && !tabs.some((t) => t.orgId === active);
  const ctx = { isHost: isHostViewer, postByHost: post.authorSide === "host" };

  return (
    <div className="cmts" data-testid="thread">
      <div className="cnote">
        <IconLock size={13} />
        {note}
      </div>
      {isHostViewer && (tabs.length > 0 || pending) && (
        <div className="threadtabs" role="tablist" aria-label="Luồng theo công ty">
          {tabs.map((t) => (
            <button
              key={t.orgId}
              type="button"
              role="tab"
              aria-selected={t.orgId === active}
              className={t.orgId === active ? "chip on" : "chip"}
              onClick={() => load(t.orgId)}
            >
              {t.orgName} <span className="n">{t.count}</span>
            </button>
          ))}
          {pending && (
            <button type="button" role="tab" aria-selected className="chip on">
              {partners.find((p) => p.id === active)?.name} <span className="n">mới</span>
            </button>
          )}
        </div>
      )}
      {isHostViewer && tabs.length === 0 && !pending && (
        <div className="cnote">Chưa có luồng nào. Khi đối tác bình luận, luồng hiện ở đây.</div>
      )}
      {startable.length > 0 && (
        <select
          className="chip"
          aria-label="Nhắn riêng"
          value=""
          onChange={(e) => {
            if (!e.target.value) return;
            setActive(e.target.value);
            setThread(null);
          }}
        >
          <option value="">Nhắn riêng…</option>
          {startable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {thread?.comments.map((c) => (
        <CommentItem
          key={c.id}
          comment={c}
          action={extra?.(c)}
          actions={commentActions(c, ctx)}
          onEdit={(t) => mutate(api.editComment(post.id, c.id, t))}
          onDelete={() => mutate(api.deleteComment(post.id, c.id))}
          onHide={(h) => mutate(api.hideComment(post.id, c.id, h))}
        />
      ))}
      {canWrite && (
        <div className="cinput">
          <span className="av sm t1">{initials(viewer.orgName)}</span>
          <input
            aria-label="Viết bình luận"
            placeholder="Viết bình luận…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button type="button" className="sendbtn" onClick={send} aria-label="Gửi bình luận">
            <IconSend size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
