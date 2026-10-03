# run — lõi run (UC-02, 04, 05, 06, 08 · CHAT-AC-05..09, 28)
`api.ts` E12–E15; `run-store` (store ngoài React, `useRuns` + selector); `lib/reducer` (phase, `cold`, `run.finished.content` thay chữ); `run-driver` (rAF gộp delta, nối lại `Last-Event-ID` 0,5→8 s ×5 → `lost`, 410 → làm mới, Dừng không abort); `runtime` (singleton); hooks `useRunStream`/`useActiveRun`/`useRunByKey`, `useSend`.
