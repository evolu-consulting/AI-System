// HUB-FR-101 · X2b D6: đầu khối agent — "Tên agent · @key · <B> hỏi · giờ" (B = `caller` của chính lượt đó).
import { ConsultantAvatar } from "~/components/shared/ConsultantAvatar";

type Props = {
  name: string;
  /** Vắng = Orchestrator (không có `@key`). */
  agentKey?: string;
  /** "Lan hỏi" / "Bạn hỏi" (đã dịch). */
  askedBy: string;
  time?: string;
};

export function AgentBlockHeader({ name, agentKey, askedBy, time }: Props) {
  return (
    <ConsultantAvatar name={name}>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-caption font-normal text-muted-foreground">
        {agentKey && <span className="font-mono">{`@${agentKey}`}</span>}
        {askedBy && (
          <>
            <span aria-hidden>·</span>
            <span>{askedBy}</span>
          </>
        )}
        {time && (
          <>
            <span aria-hidden>·</span>
            <span>{time}</span>
          </>
        )}
      </span>
    </ConsultantAvatar>
  );
}
