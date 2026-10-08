// CHAT-AC-14..17 · nội dung chung của khung flow (panel/sheet): header (tiêu đề, "{n} tin · nhớ cả flow", ✕), luồng tin, ô nhập.
import type { Flow } from "@ai/contracts/chat";
import type { Ref } from "react";
import { Composer, type ComposerHandle } from "~/features/composer/components/Composer";
import { useDraftKey } from "~/features/composer/hooks/use-draft";
import type { FlowPanelData } from "../hooks/use-flow-panel";
import { FlowHeader } from "./FlowHeader";
import { FlowMessages } from "./FlowMessages";

export type FlowContentProps = {
  convId: string;
  flow: Flow;
  data: FlowPanelData;
  mobile: boolean;
  onClose(): void;
  composerRef?: Ref<ComposerHandle>;
};

export function FlowContent({
  convId,
  flow,
  data,
  mobile,
  onClose,
  composerRef,
}: FlowContentProps) {
  const flowDraftKey = useDraftKey(convId, flow.id);
  return (
    <>
      <FlowHeader title={flow.title} count={flow.message_count} mobile={mobile} onClose={onClose} />
      <FlowMessages data={data} />
      <div className="shrink-0 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Composer
          ref={composerRef}
          variant="flow"
          draftKey={flowDraftKey}
          autoFocus={!mobile}
          {...data.composer}
        />
      </div>
    </>
  );
}
