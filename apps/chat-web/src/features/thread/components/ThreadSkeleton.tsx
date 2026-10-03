// CHAT-AC-20 · đang tải hội thoại: 3 tin giả (câu hỏi phải, câu trả lời trái).
import { Skeleton } from "~/components/ui/skeleton";

export function ThreadSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-4"
        >
          <Skeleton className="h-9 w-1/2 self-end rounded-xl" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}
