// HUB-FR-10/91 · CR-056 · ba menu gợi ý dưới ô nhập (`/` lệnh, `@` agent, `!` quy trình); tách khỏi `Composer` để giữ ≤ 200 dòng.

import { ProcessMenu } from "~/features/processes/composer/components/ProcessMenu";
import type { BangSuggest } from "~/features/processes/composer/hooks/use-bang-suggest";
import type { AgentSuggest, CommandSuggest } from "../hooks/use-suggest";
import { AgentMenu } from "./AgentMenu";
import { CommandMenu } from "./CommandMenu";

type Props = {
  command: CommandSuggest;
  agent: AgentSuggest;
  bang: BangSuggest;
  /** Tiêu đề nhìn thấy của menu `@`. */
  agentTitle?: string;
  onPick(index?: number): void;
};

export function ComposerMenus({ command, agent, bang, agentTitle, onPick }: Props) {
  return (
    <>
      {command.open && <CommandMenu suggest={command} onPick={onPick} />}
      {agent.open && <AgentMenu suggest={agent} onPick={onPick} title={agentTitle} />}
      {!agent.open && bang.open && <ProcessMenu suggest={bang} onPick={onPick} />}
    </>
  );
}
