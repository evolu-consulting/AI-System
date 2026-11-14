// CR-161 · lát 8 · tab «Trò chuyện» của trang đối tác đã kết nối: một cuộc trò chuyện chung cho người Toàn quyền hai công ty.
// Trống · có tin theo ngày (tải thêm tin cũ) · chỉ đọc sau ngắt (ẩn ô soạn + câu giải thích) · lỗi. Tin mới tự hiện qua `cc.msg`.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Empty, Loading } from "~/components/shared/states";
import { Btn } from "~/components/ui/Btn";
import { useCcStream, useMarkRead, useThread } from "../hooks/use-cc-chat";
import { groupByDay } from "../lib/cc-chat";
import { ChatComposer } from "./ChatComposer";
import { ChatMessage } from "./ChatMessage";

export function ChatTab({ other, name }: { other: string; name: string }) {
  const { t, i18n } = useTranslation();
  const th = useThread(other);
  useCcStream(other);
  useMarkRead(other, th.messages, th.lastRead, !th.q.isLoading && !th.q.error);
  const groups = useMemo(() => groupByDay(th.messages), [th.messages]);
  const day = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }),
    [i18n.language],
  );
  if (th.q.isLoading) return <Loading />;
  if (th.noThread)
    return <p className="text-label text-dim">{t("contracts.connect.chat.noThread", { name })}</p>;
  if (th.q.error)
    return (
      <p role="alert" className="text-label text-late">
        {t("contracts.connect.err.failed")}
      </p>
    );
  return (
    <div className="flex flex-col gap-3" data-testid="cc-chat">
      <p className="m-0 rounded-xl border border-rule bg-sunk px-4 py-3 text-label text-dim">
        {t("contracts.connect.chat.banner", { name })}
      </p>
      {th.readOnly && (
        <p
          role="status"
          data-testid="cc-readonly"
          className="m-0 rounded-xl border border-rule bg-soon-bg px-4 py-3 text-label text-soon"
        >
          {t("contracts.connect.chat.readOnly")}
        </p>
      )}
      {th.q.hasNextPage && (
        <div className="text-center">
          <Btn
            size="sm"
            variant="outline"
            loading={th.q.isFetchingNextPage}
            onClick={() => void th.q.fetchNextPage()}
          >
            {t("contracts.connect.chat.older")}
          </Btn>
        </div>
      )}
      {th.messages.length === 0 ? (
        <Empty title={t("contracts.connect.chat.empty")}>
          {th.readOnly ? null : t("contracts.connect.chat.emptyHint", { name })}
        </Empty>
      ) : (
        <ol
          className="m-0 flex list-none flex-col gap-4 p-0"
          aria-label={t("contracts.connect.chat.list")}
        >
          {groups.map((g) => (
            <li key={g.day} className="flex flex-col gap-3">
              <span className="self-center text-[12px] text-dim">
                {day.format(new Date(g.items[0]?.created_at ?? ""))}
              </span>
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {g.items.map((m) => (
                  <ChatMessage key={m.seq} m={m} />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {!th.readOnly && <ChatComposer other={other} />}
    </div>
  );
}
