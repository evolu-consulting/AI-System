# P6 · Ma trận truy vết

Thuộc `index.md` (CR-107). Cột Code/Test điền khi làm (`bun run trace ADM-FR-xx`).

| FR | Phần | Chức năng | Nguồn (BA / ADR / code hiện có) | AC | Code | Test |
|---|---|---|---|---|---|---|
| ADM-FR-76 | P0 | Bất biến + quyết định | BA §2, §7; ADR-0033 | P0-AC01…03 | — | — |
| ADM-FR-77 | P1 | Nav lồng theo công ty | BA D1; `nav.ts:118-147` | P1-AC01,02,05 | — | — |
| ADM-FR-78 | P1 | Wizard onboard | BA D3; `users.service.ts:69-83`; `packs.service.ts:72-92` | P1-AC03,04 | — | — |
| ADM-FR-79 | P2 | Workspace tab + redirect | BA D1,D2; `TenantDetailPage.tsx:158-166` | P2-AC01…03 | — | — |
| ADM-FR-80 | P3 | Vai theo app + vai tuỳ biến (UI) | BA D4②; ADR §3,§6 | P3-AC01…06 | — | — |
| ADM-FR-81 | P3 | Gán user vào vai (UI) | BA D4③ | P3-AC02,03,07 | — | — |
| ADM-FR-82 | P4 | Bảng + biên dịch | ADR §1,§2 | P4-AC01…04,07 | — | — |
| ADM-FR-83 | P4 | Endpoint + gating | ADR hệ quả | P4-AC04,05 | — | — |
| ADM-FR-84 | P4 | Luật 409 + managed_by_role_id | ADR §5,§6 | P4-AC06 | — | — |
| ADM-FR-85 | P5 | Backfill | ADR §4 | P5-AC01…04 | — | — |

Tương tác CR-106: `caps.contracts` dùng `packActionsFor`, không đọc bảng vai (ADR §7).
