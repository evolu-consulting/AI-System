// Bình luận riêng theo (bài × công ty) (D3): chủ quản có tab theo công ty; đối tác chỉ thấy luồng của mình.
import type { PostView, ThreadSummary, Thread as ThreadT } from "@ai/contracts/community";
import { useCallback, useEffect, useState } from "react";
import { initials, timeAgo, tone } from "../lib/format";
import { useApp } from "./ctx";
import { Highlighted } from "./Highlighted";
import { IconLock, IconSend } from "./icons";

export function Thread({ post, onChanged }: { post: PostView; onChanged: () => void }) {
  const { api, viewer, isHostViewer, rev } = useApp();
  const [tabs, setTabs] = useState<ThreadSummary[]>([]);
  const [active, setActive] = useState<string>("");
  const [thread, setThread] = useState<ThreadT | null>(null);
  const [text, setText] = useState("");

  const load = useCallback(
    async (org?: string) => {
      const list = await api.listThreads(post.id);
      setTabs(list);
      const cur = org ?? (list.some((t) => t.orgId === active) ? active : (list[0]?.orgId ?? ""));
      setActive(cur);
      setThread(cur ? await api.getThread(post.id, cur) : null);
    },
    [api, post.id, active],
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
  const note = isHostViewer
    ? "Mỗi đối tác một luồng riêng: đối tác chỉ thấy trao đổi của chính họ với bạn."
    : "Chỉ chủ quản thấy trao đổi này.";
  const canWrite = !isHostViewer || Boolean(active);

  return (
    <div className="cmts" data-testid="thread">
      <div className="cnote">
        <IconLock size={13} />
        {note}
      </div>
      {isHostViewer && tabs.length > 0 && (
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
        </div>
      )}
      {isHostViewer && tabs.length === 0 && (
        <div className="cnote">Chưa có luồng nào. Khi đối tác bình luận, luồng hiện ở đây.</div>
      )}
      {thread?.comments.map((c) => (
        <div className="cmt" key={c.id}>
          <span className={`av sm ${tone(c.authorOrgId, c.authorSide === "host")}`}>
            {initials(c.authorOrgName)}
          </span>
          <div>
            <div className="bubble">
              <b>
                {c.authorOrgName} · {c.authorName}
              </b>
              <p>
                <Highlighted text={c.text} hits={c.hits} field="body" />
              </p>
            </div>
            <div className="ctime">
              {timeAgo(c.createdAt)}
              {c.hidden ? " · đã ẩn" : ""}
            </div>
          </div>
        </div>
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
