// CR-056 · P-a Bước 0: STUB PF3 — `process.notice` tới: cập nhật DM "Quy trình" (`processKeys.inbox`) + huy hiệu. PF3 hiện thực.
import type { ProcessNoticeEventData } from "@ai/contracts/chat";
import type { QueryClient } from "@tanstack/react-query";

export function onProcessNotice(_client: QueryClient, _data: ProcessNoticeEventData): void {}
