// CR-056 · P-a Bước 0: STUB PF1 — danh sách run của hội thoại/phòng (khoá `processKeys.runs`). PF1 hiện thực.
export function useProcessRoomRuns(_scope: { conversationId?: string; roomId?: string }) {
  return { runs: [] as never[], isPending: false };
}
