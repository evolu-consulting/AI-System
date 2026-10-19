# HD9 — tasks (một agent làm trọn lát, CR-094 đợt 3)

| # | Việc | Làn | FR | Xong khi | Trạng thái |
|---|---|---|---|---|---|
| A1 | spec + plan + quyết định + readiness 1 vòng (mặc định áp luôn) | đầy đủ | 91–97 | `readiness.md` | [x] |
| A2 | Test TRƯỚC code: tiền/tồn/nhật ký giá (`price.int`), quyền/tenant (`access.int`), RLS 8 bảng (`rls-packs.int`) | đầy đủ (tiền, quyền, RLS) | 91–96 | đỏ đúng lý do (thiếu bảng/route) | [x] |
| A3 | Contract zod `cks.ts` + migration `0004_cks` (8 bảng, RLS, REVOKE) | đầy đủ | 91–96 | `bun test packages/contracts` | [x] |
| A4 | Domain thuần (serial/DER, văn bản ký, bán/gia hạn, khách, giá half-even) + unit | nhanh (thuần) | 92–96 | `bun test …/cks` | [x] |
| A5 | Repo + use case + route + mount; khách có trang (HD9-AC09) | đầy đủ | 91–96 | int HD9 xanh | [x] |
| A6 | Văn bản đã ký (`signed.int`), đếm câu SQL (`sqlcount.int`), perf (`perf/cks.perf.int`, PERF=1) | đầy đủ (perf) | 95 · NFR | int + perf | [x] |
| A7 | FE S10 `/cks`, S11 `/cks/$id` + 3 hộp thoại, S08 `/prices` + i18n + unit | nhanh | 97 | `bun test apps/contracts-web` | [x] |
| A8 | e2e so màn hình S08/S10/S11 + baseline mgmt-app | nhanh | 97 | `bun run e2e:contracts` | [x] 13/13 |
| A9 | Cổng lát `test:affected` + commit | — | — | báo cáo | [ ] |

Nợ / để lát khác: công nợ `paid` (HD7), gửi nhắc `cks_followups` (HD4), sự kiện uy tín khách (HD8), S09 + "Dò giá" agent (HD8/N2), nhập Excel qua trợ lý (HD6).
