// CR-056 · P-a FD1/FD9: query key của quy trình — một nơi để realtime (patch/invalidate) và các PF dùng chung.
export const processKeys = {
  all: ["process"] as const,
  /** Cờ engine (dò lúc chạy, FD2). */
  engine: ["process", "engine"] as const,
  /** Chuỗi `process.*` đã nạp cho ngôn ngữ `lng`. */
  locale: (lng: string) => ["process", "locale", lng] as const,
  catalog: ["process", "catalog"] as const,
  /** P-b · chip nguồn (`GET /process-runs/sources`). */
  sourceChips: ["process", "sourceChips"] as const,
  run: (id: string) => ["process", "run", id] as const,
  runs: (filter: string) => ["process", "runs", filter] as const,
  output: (outputId: string) => ["process", "output", outputId] as const,
  usage: (id: string) => ["process", "usage", id] as const,
  /** "Chờ tôi kiểm" (`GET /me/review-tasks`). */
  tasks: ["process", "tasks"] as const,
  /** DM "Quy trình" (`GET /me/process-inbox`). */
  inbox: ["process", "inbox"] as const,
};
