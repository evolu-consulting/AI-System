# chat-web · features/processes (P-a, CR-056)

Quy trình (Process Engine) ở chat: menu `!`, khối quy trình + thread phòng, hỏi lại, "Chờ tôi kiểm", DM "Quy trình", `/runs/$id`, token.
Plan: `docs/specs/P-process-engine/plan-frontend*.md` (§9 Bước 0 · §10 sở hữu file).

## Bước 0 đã có (thin, không logic nghiệp vụ PF)
| Phần | File |
|---|---|
| Cờ engine (FD2) | `shared/engine.tsx` (`useProcessEngine`, `useProcessEngineOn`, `ProcessEngineGate`, `useEngineRoute`), `shared/api.ts` `probeEngine` — `on` chỉ khi Hub 200 **và** chuỗi `process.*` đã nạp |
| Dùng chung | `shared/{keys,types}.ts`, `shared/lib/{status,format,decision-reason,thread-task}.ts`, `shared/hooks/{use-process-run,use-thread-run,use-output,use-in-view}.ts`, `shared/components/{RunStatusBadge,StageStrip,OutputView,TaskPanel,TaskWaitingNote,ProcessRouteGate}.tsx` |
| Thread | `shared/thread/{ProcessThreadMessage,ProcessTimelineItem,thread-binding}.tsx` (`ThreadBindingProvider` bọc ở `RoomFlowPane` nhánh `process`) |
| Realtime | `realtime/process-events.ts` (+ `inbox/on-process-notice.ts` stub PF3); `event-router`/`me-stream-driver` đã nối |
| Stub PF | mọi file `components/*`, `hooks/*`, `api.ts` trong `composer/`, `run-block/`, `ask/`, `inbox/`, `run-page/`, `usage/` — render `null`/no-op, **giữ nguyên tên export + props** |
| Route | `routes/_authed/runs.$id.tsx` (`?task=`), `routes/_authed/process-inbox.tsx` — cờ off ⇒ "Không tìm thấy" (`processRoute.notFound`, chuỗi chat vì bundle `process.*` chưa nạp) |

## Móc vào file chung (đã làm)
`Composer` (`processMenu`, `sendLabel`, `ComposerMenus`, `ComposerRow.extra`, `useComposerSuggest(…, bang)`, `PROCESS_MENU_ID`) · `send-error` (`PROCESS_NOT_FOUND` ⇒ gợi ý `!key`, `TOO_MANY_PROCESS_RUNS` ⇒ đếm ngược, `PROCESS_THREAD_NO_AGENT`) ·
`RoomComposer`/`WelcomePage`/`ConversationPage` (`processMenu`, `useBangSubmit(...).intercept`) · `Sidebar` (`TodoGroup`, `usersPinned={<ProcessDmRow/>}`) · `RoomSections.usersPinned` · `AskCard.hint` ·
`RoomTimeline` → `ProcessTimelineItem` → `ProcessBlock` · `RoomFlowPane` → `useFlowKind` → `ProcessFlowContent` · `FlowFooter.hideCopy` · `FlowRecent` (avatar quy trình) · `room-agent` (`isOwnTurn`/`withRecent`) · `lib/http` (`ChatProcessErrorCode`).

## Quy ước cho PF
- Chỉ sửa file của mình (plan-frontend §10); gọi API **chỉ** trong `<pf>/api.ts`; component không import `api.ts`/`lib/http`.
- Chuỗi: `locales/process/<phần>.{vi,en}.json` = **cây con của `process.<phần>`** (khoá đầy đủ `t("process.<phần>.<tên>")`). Bước 0 đã nạp đủ khoá từ phụ lục i18n — PF chỉ sửa/bổ sung phần của mình, chạy `bun run i18n:check`.
- Mọi lối vào bọc `ProcessEngineGate`/`useProcessEngineOn()`; không `on` ⇒ không vẽ gì.
- `ProcessDmRow` phải trả về một `<li>`.

## Thư mục PF (đã hoàn thành, P-a)
| Thư mục | Nội dung |
|---|---|
| `composer/` | `ProcessMenu` (menu `!`), `ProcessButton` (nút ▶ "Quy trình") |
| `run-block/` | khối quy trình trong dòng thời gian/thread: `ProcessBlock`, `RunCard`, `DecisionCard`, `ReviewTaskCard`, `OutputMessage`, `CancelRunButton`… |
| `run-page/` | `/runs/$id`: `RunPage` + tab Tiến độ (`ProgressTab`), Nhật ký (`LogTab`), Token (slot → `usage/UsageTab`) |
| `inbox/` | "Chờ tôi kiểm" (`TodoGroup`), DM "Quy trình" (`ProcessDmRow`), `/process-inbox` |
| `ask/` | hỏi lại / nhờ người khác: `AskCards`, `AskAnswerBox`, `ForwardDialog` |
| `usage/` | tab Token (`UsageTab`, KPI, bảng giai đoạn, bảng lượt gọi) — nhân đôi với admin-web (TECH-DEBT) |

Cờ engine: Hub `HUB_PROCESS_ENGINE=on|off` (mặc định `off`; dev bật trong `.env.example`). FE dò bằng `shared/api.ts` `probeEngine`; off ⇒ không vẽ gì, route ⇒ "Không tìm thấy".
