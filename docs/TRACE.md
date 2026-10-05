# TRACE — yêu cầu → spec → code → test

Sinh tự động bằng `bun run trace` (M0) từ frontmatter spec, comment đầu module, tên test. Không sửa tay.
Tra một mã: `bun run trace ADM-FR-32`. CI đỏ khi một FR **MUST** trong mốc đã duyệt chưa có test.

| FR | Ưu tiên | Spec | Code | Test | Trạng thái |
|---|---|---|---|---|---|
| ADM-FR-01 | MUST | docs/specs/M1-foundation-identity/spec.md | 39 file | 19 file | có test |
| ADM-FR-02 | MUST | docs/specs/M1-foundation-identity/spec.md | 12 file | 9 file | có test |
| ADM-FR-03 | MUST | docs/specs/M1-foundation-identity/spec.md | 12 file | 4 file | có test |
| ADM-FR-04 | MUST | docs/specs/M1-foundation-identity/spec.md | 42 file | 11 file | có test |
| ADM-FR-05 | MUST | docs/specs/M1-foundation-identity/spec.md | 11 file | 7 file | có test |
| ADM-FR-06 | SHOULD | docs/specs/M1-foundation-identity/spec.md | 15 file | 10 file | có test |
| ADM-FR-07 | SHOULD | docs/specs/M1-foundation-identity/spec.md | 6 file | 7 file | có test |
| ADM-FR-08 | SHOULD | docs/specs/M4-ops/spec.md | 38 file | 21 file | có test |
| ADM-FR-60 | MUST | docs/specs/M1-foundation-identity/spec.md | 50 file | 11 file | có test |
| ADM-FR-61 | MUST | docs/specs/M1-foundation-identity/spec.md | 11 file | 4 file | có test |
| ADM-FR-62 | MUST | docs/specs/M3-permissions/spec.md | 49 file | 23 file | có test |
| ADM-FR-63 | MUST | docs/specs/M1-foundation-identity/spec.md | 15 file | 8 file | có test |
| ADM-FR-10 | MUST | docs/specs/M2-catalog-command/spec.md | 21 file | 12 file | có test |
| ADM-FR-11 | MUST | docs/specs/M2-catalog-command/spec.md | 10 file | 5 file | có test |
| ADM-FR-12 | COULD | docs/specs/M2-catalog-command/spec.md |  | 3 file | có test |
| ADM-FR-13 | MUST | docs/specs/M2-catalog-command/spec.md | 18 file | 6 file | có test |
| ADM-FR-14 | MUST | docs/specs/M2-catalog-command/spec.md | 20 file | 5 file | có test |
| ADM-FR-15 | MUST | docs/specs/M2-catalog-command/spec.md | 12 file | 5 file | có test |
| ADM-FR-20 | MUST | docs/specs/M2-catalog-command/spec.md | 41 file | 16 file | có test |
| ADM-FR-21 | MUST | docs/specs/H2c-attachments/spec.md<br>docs/specs/M2-catalog-command/spec.md | 11 file | 5 file | có test |
| ADM-FR-22 | MUST | docs/specs/M2-catalog-command/spec.md | 12 file | 11 file | có test |
| ADM-FR-23 | MUST |  |  |  | chưa spec |
| ADM-FR-24 | SHOULD | docs/specs/M2-catalog-command/spec.md<br>docs/specs/M3-permissions/spec.md | 12 file | 12 file | có test |
| ADM-FR-30 | MUST | docs/specs/M2-catalog-command/spec.md | 34 file | 11 file | có test |
| ADM-FR-31 | MUST | docs/specs/M2-catalog-command/spec.md | 13 file | 8 file | có test |
| ADM-FR-32 | MUST | docs/specs/M3-permissions/spec.md | 20 file | 13 file | có test |
| ADM-FR-33 | MUST | docs/specs/M2-catalog-command/spec.md | 12 file | 6 file | có test |
| ADM-FR-34 | SHOULD | docs/specs/M2-catalog-command/spec.md | 7 file | 7 file | có test |
| ADM-FR-35 | SHOULD | docs/specs/M3-permissions/spec.md | 24 file | 12 file | có test |
| ADM-FR-36 | MUST | docs/specs/M3-permissions/spec.md | 21 file | 12 file | có test |
| ADM-FR-37 | MUST |  |  |  | chưa spec |
| ADM-FR-40 | MUST | docs/specs/M4-ops/spec.md | 17 file | 10 file | có test |
| ADM-FR-41 | MUST | docs/specs/M4-ops/spec.md | 24 file | 9 file | có test |
| ADM-FR-42 | MUST | docs/specs/M4-ops/spec.md | 31 file | 11 file | có test |
| ADM-FR-50 | MUST | docs/specs/M2-catalog-command/spec.md | 24 file | 19 file | có test |
| ADM-FR-51 | MUST | docs/specs/M4-ops/spec.md | 30 file | 18 file | có test |
| ADM-FR-52 | SHOULD | docs/specs/M4-ops/spec.md | 17 file | 7 file | có test |
| ADM-FR-53 | MUST | docs/specs/M3-permissions/spec.md | 7 file | 13 file | có test |
| ADM-FR-54 | SHOULD | docs/specs/M4-ops/spec.md | 28 file | 14 file | có test |
| ADM-FR-55 | MUST | docs/specs/M3-permissions/spec.md | 24 file | 18 file | có test |
| ADM-BR-01 | — | docs/specs/M2-catalog-command/spec.md | 8 file | 10 file | có test |
| ADM-BR-02 | — | docs/specs/M2-catalog-command/spec.md | 3 file | 4 file | có test |
| ADM-BR-04 | — | docs/specs/M2-catalog-command/spec.md<br>docs/specs/M4-ops/spec.md | 11 file | 7 file | có test |
| ADM-BR-05 | — | docs/specs/M1-foundation-identity/spec.md | 8 file | 9 file | có test |
| ADM-BR-06 | — | docs/specs/M2-catalog-command/spec.md | 6 file | 2 file | có test |
| ADM-BR-08 | — | docs/specs/M1-foundation-identity/spec.md | 3 file | 7 file | có test |
| ADM-BR-09 | — | docs/specs/M1-foundation-identity/spec.md<br>docs/specs/M4-ops/spec.md | 18 file | 29 file | có test |
| ADM-BR-10 | — | docs/specs/M2-catalog-command/spec.md | 17 file | 13 file | có test |
| ADM-BR-11 | — | docs/specs/M3-permissions/spec.md | 5 file | 1 file | có test |
| ADM-BR-12 | — | docs/specs/M3-permissions/spec.md | 12 file | 9 file | có test |
| ADM-BR-13 | — | docs/specs/M2-catalog-command/spec.md |  |  | có spec |
| ADM-BR-14 | — | docs/specs/M2-catalog-command/spec.md | 1 file | 4 file | có test |
| ADM-NFR-01 | — | docs/specs/M1-foundation-identity/spec.md | 10 file | 12 file | có test |
| ADM-NFR-02 | — |  |  |  | chưa spec |
| ADM-NFR-03 | — |  | 2 file | 3 file | chưa spec |
| ADM-NFR-04 | — |  |  |  | chưa spec |
| ADM-NFR-05 | — |  |  |  | chưa spec |
| ADM-NFR-06 | — | docs/specs/M0-bootstrap/spec.md<br>docs/specs/M1-foundation-identity/spec.md | 47 file | 44 file | có test |
| ADM-NFR-07 | — | docs/specs/M1-foundation-identity/spec.md | 16 file | 13 file | có test |
| HUB-FR-01 | MUST | docs/specs/H1-hub-core/spec.md | 2 file | 1 file | có test |
| HUB-FR-02 | MUST | docs/specs/H1-hub-core/spec.md | 3 file | 1 file | có test |
| HUB-FR-03 | MUST | docs/specs/H1-hub-core/spec.md | 3 file | 1 file | có test |
| HUB-FR-04 | MUST |  |  |  | chưa spec |
| HUB-FR-10 | MUST | docs/specs/H2a-dify-command/spec.md | 8 file | 3 file | có test |
| HUB-FR-11 | MUST | docs/specs/H2a-dify-command/spec.md | 7 file | 1 file | có test |
| HUB-FR-12 | MUST | docs/specs/H2a-dify-command/spec.md<br>docs/specs/H2c-attachments/spec.md | 8 file | 8 file | có test |
| HUB-FR-13 | MUST | docs/specs/H2a-dify-command/spec.md | 7 file | 5 file | có test |
| HUB-FR-14 | SHOULD | docs/specs/H2a-dify-command/spec.md | 3 file | 1 file | có test |
| HUB-FR-20 | MUST | docs/specs/H1-hub-core/spec.md | 5 file | 2 file | có test |
| HUB-FR-21 | MUST | docs/specs/H1-hub-core/spec.md | 2 file | 1 file | có test |
| HUB-FR-22 | MUST |  |  |  | chưa spec |
| HUB-FR-23 | MUST | docs/specs/H2a-dify-command/spec.md | 9 file | 6 file | có test |
| HUB-FR-24 | MUST | docs/specs/H2a-dify-command/spec.md | 3 file | 2 file | có test |
| HUB-FR-25 | MUST | docs/specs/H1-hub-core/spec.md |  | 1 file | có test |
| HUB-FR-26 | COULD |  |  |  | chưa spec |
| HUB-FR-27 | MUST | docs/specs/H1-hub-core/spec.md | 7 file | 3 file | có test |
| HUB-FR-28 | MUST | docs/specs/H1-hub-core/spec.md | 2 file | 1 file | có test |
| HUB-FR-29 | SHOULD | docs/specs/H1-hub-core/spec.md | 3 file | 1 file | có test |
| HUB-FR-89 | MUST | docs/specs/H1-hub-core/spec.md<br>docs/specs/H3a-subscription/spec.md | 42 file | 12 file | có test |
| HUB-FR-90 | MUST | docs/specs/H1-hub-core/spec.md | 4 file | 1 file | có test |
| HUB-FR-91 | MUST | docs/specs/H2b-routing/spec.md | 9 file | 10 file | có test |
| HUB-FR-92 | MUST | docs/specs/H2b-routing/spec.md | 5 file | 6 file | có test |
| HUB-FR-94 | MUST | docs/specs/H2b-routing/spec.md | 3 file | 7 file | có test |
| HUB-FR-95 | MUST | docs/specs/H2a-dify-command/spec.md<br>docs/specs/H2b-routing/spec.md | 12 file | 17 file | có test |
| HUB-FR-30 | MUST |  |  |  | chưa spec |
| HUB-FR-31 | MUST | docs/specs/H1-hub-core/spec.md |  | 1 file | có test |
| HUB-FR-32 | MUST | docs/specs/H1-hub-core/spec.md |  | 1 file | có test |
| HUB-FR-33 | MUST | docs/specs/H1-hub-core/spec.md |  | 1 file | có test |
| HUB-FR-40 | MUST | docs/specs/C1-chat-ui/spec.md<br>docs/specs/H1-hub-core/spec.md | 5 file | 4 file | có test |
| HUB-FR-41 | MUST | docs/specs/C1-chat-ui/spec.md<br>docs/specs/H1-hub-core/spec.md | 5 file | 3 file | có test |
| HUB-FR-45 | MUST | docs/specs/C1-chat-ui/spec.md<br>docs/specs/H1-hub-core/spec.md | 8 file | 3 file | có test |
| HUB-FR-42 | SHOULD | docs/specs/C1-chat-ui/spec.md<br>docs/specs/H1-hub-core/spec.md | 7 file | 3 file | có test |
| HUB-FR-43 | MUST | docs/specs/C1-chat-ui/spec.md<br>docs/specs/H1-hub-core/spec.md | 8 file | 3 file | có test |
| HUB-FR-44 | MUST | docs/specs/H2c-attachments/spec.md | 20 file | 20 file | có test |
| HUB-FR-50 | MUST | docs/specs/H2a-dify-command/spec.md<br>docs/specs/H2c-attachments/spec.md | 13 file | 11 file | có test |
| HUB-FR-51 | MUST | docs/specs/H2a-dify-command/spec.md | 5 file | 3 file | có test |
| HUB-FR-52 | SHOULD |  |  |  | chưa spec |
| HUB-FR-53 | SHOULD |  |  |  | chưa spec |
| HUB-FR-60 | MUST | docs/specs/H1-hub-core/spec.md | 5 file | 1 file | có test |
| HUB-FR-61 | MUST | docs/specs/H1-hub-core/spec.md | 4 file | 1 file | có test |
| HUB-FR-62 | MUST | docs/specs/H1-hub-core/spec.md<br>docs/specs/H2b-routing/spec.md | 5 file | 7 file | có test |
| HUB-FR-63 | MUST |  |  |  | chưa spec |
| HUB-FR-64 | MUST |  |  |  | chưa spec |
| HUB-FR-65 | MUST |  |  |  | chưa spec |
| HUB-FR-66 | MUST |  |  |  | chưa spec |
| HUB-FR-67 | MUST |  |  |  | chưa spec |
| HUB-FR-68 | MUST |  |  |  | chưa spec |
| HUB-FR-69 | MUST |  |  |  | chưa spec |
| HUB-FR-70 | MUST |  |  |  | chưa spec |
| HUB-FR-71 | SHOULD |  |  |  | chưa spec |
| HUB-FR-72 | MUST |  |  |  | chưa spec |
| HUB-FR-73 | MUST |  |  |  | chưa spec |
| HUB-FR-74 | MUST | docs/specs/H1-hub-core/spec.md | 1 file | 1 file | có test |
| HUB-FR-75 | MUST | docs/specs/H1-hub-core/spec.md<br>docs/specs/H2c-attachments/spec.md | 14 file | 10 file | có test |
| HUB-FR-76 | MUST | docs/specs/H2a-dify-command/spec.md | 4 file | 3 file | có test |
| HUB-FR-77 | MUST | docs/specs/H1-hub-core/spec.md<br>docs/specs/H2b-routing/spec.md | 1 file | 4 file | có test |
| HUB-FR-78 | MUST |  |  |  | chưa spec |
| HUB-FR-79 | SHOULD |  |  |  | chưa spec |
| HUB-FR-80 | MUST | docs/specs/H2a-dify-command/spec.md | 6 file | 4 file | có test |
| HUB-FR-81 | MUST |  |  |  | chưa spec |
| HUB-FR-82 | MUST |  |  |  | chưa spec |
| HUB-FR-83 | MUST | docs/specs/H1-hub-core/spec.md |  | 1 file | có test |
| HUB-FR-84 | MUST |  |  |  | chưa spec |
| HUB-FR-85 | MUST |  |  |  | chưa spec |
| HUB-FR-86 | MUST | docs/specs/H1-hub-core/spec.md<br>docs/specs/H3a-subscription/spec.md |  | 1 file | có test |
| HUB-FR-87 | MUST |  |  |  | chưa spec |
| HUB-FR-88 | SHOULD | docs/specs/H1-hub-core/spec.md | 1 file | 1 file | có test |
| HUB-FR-93 | SHOULD |  |  |  | chưa spec |
| HUB-BR-01 | — | docs/specs/H2a-dify-command/spec.md | 2 file | 1 file | có test |
| HUB-BR-02 | — | docs/specs/H1-hub-core/spec.md |  |  | có spec |
| HUB-BR-03 | — | docs/specs/H1-hub-core/spec.md<br>docs/specs/H2b-routing/spec.md | 3 file | 6 file | có test |
| HUB-BR-04 | — | docs/specs/H1-hub-core/spec.md<br>docs/specs/H2a-dify-command/spec.md<br>docs/specs/H3a-subscription/spec.md | 4 file | 10 file | có test |
| HUB-BR-05 | — |  |  |  | chưa spec |
| HUB-BR-06 | — | docs/specs/H1-hub-core/spec.md<br>docs/specs/H2a-dify-command/spec.md<br>docs/specs/H2b-routing/spec.md | 9 file | 4 file | có test |
| HUB-BR-07 | — |  |  |  | chưa spec |
| HUB-BR-08 | — | docs/specs/H1-hub-core/spec.md<br>docs/specs/H2b-routing/spec.md | 5 file | 4 file | có test |
| HUB-BR-09 | — |  |  |  | chưa spec |
| HUB-BR-10 | — |  |  |  | chưa spec |
| HUB-BR-11 | — | docs/specs/H2a-dify-command/spec.md |  |  | có spec |
| HUB-BR-12 | — | docs/specs/H2a-dify-command/spec.md |  | 1 file | có test |
| HUB-BR-13 | — |  |  |  | chưa spec |
| HUB-BR-14 | — | docs/specs/H1-hub-core/spec.md | 3 file | 1 file | có test |
| HUB-BR-15 | — |  |  |  | chưa spec |
| HUB-BR-16 | — |  |  |  | chưa spec |
| HUB-BR-17 | — |  |  |  | chưa spec |
| HUB-BR-18 | — | docs/specs/H2b-routing/spec.md | 1 file | 1 file | có test |
| HUB-BR-19 | — | docs/specs/H2a-dify-command/spec.md | 2 file |  | có code |
| HUB-BR-20 | — | docs/specs/H2a-dify-command/spec.md<br>docs/specs/H2b-routing/spec.md | 2 file | 1 file | có test |
| HUB-NFR-01 | — | docs/specs/H1-hub-core/spec.md |  |  | có spec |
| HUB-NFR-02 | — | docs/specs/H1-hub-core/spec.md | 6 file | 2 file | có test |
| HUB-NFR-03 | — | docs/specs/H1-hub-core/spec.md | 1 file |  | có code |
| HUB-NFR-04 | — | docs/specs/H1-hub-core/spec.md | 10 file | 3 file | có test |
| HUB-NFR-05 | — |  |  |  | chưa spec |
| HUB-NFR-06 | — |  |  |  | chưa spec |
| WRK-FR-01 | MUST | docs/specs/H1-hub-core/spec.md | 6 file | 6 file | có test |
| WRK-FR-02 | MUST | docs/specs/H1-hub-core/spec.md | 4 file | 5 file | có test |
| WRK-FR-03 | MUST | docs/specs/H1-hub-core/spec.md<br>docs/specs/H2b-routing/spec.md | 16 file | 19 file | có test |
| WRK-FR-04 | MUST | docs/specs/H1-hub-core/spec.md | 13 file | 4 file | có test |
| WRK-FR-05 | MUST | docs/specs/H1-hub-core/spec.md | 11 file | 7 file | có test |
| WRK-FR-06 | MUST | docs/specs/H2a-dify-command/spec.md | 8 file | 11 file | có test |
| WRK-FR-07 | MUST | docs/specs/H2a-dify-command/spec.md | 14 file | 6 file | có test |
| WRK-FR-10 | MUST | docs/specs/H1-hub-core/spec.md | 14 file | 5 file | có test |
| WRK-FR-11 | MUST | docs/specs/H1-hub-core/spec.md<br>docs/specs/H2c-attachments/spec.md | 8 file | 14 file | có test |
| WRK-FR-12 | MUST | docs/specs/H1-hub-core/spec.md | 1 file | 3 file | có test |
| WRK-FR-13 | MUST | docs/specs/H2a-dify-command/spec.md | 10 file | 10 file | có test |
| WRK-FR-14 | MUST | docs/specs/H1-hub-core/spec.md | 11 file | 5 file | có test |
| WRK-FR-15 | MUST | docs/specs/H1-hub-core/spec.md<br>docs/specs/H2b-routing/spec.md<br>docs/specs/H3a-subscription/spec.md | 10 file | 22 file | có test |
| WRK-FR-16 | SHOULD |  |  |  | chưa spec |
| WRK-FR-17 | MUST | docs/specs/H1-hub-core/spec.md<br>docs/specs/H2b-routing/spec.md | 6 file | 6 file | có test |
| WRK-FR-18 | COULD | docs/specs/H2c-attachments/spec.md | 8 file | 14 file | có test |
| WRK-FR-20 | MUST | docs/specs/H1-hub-core/spec.md<br>docs/specs/H3a-subscription/spec.md | 3 file | 3 file | có test |
| WRK-FR-21 | MUST |  |  |  | chưa spec |
| WRK-FR-22 | SHOULD | docs/specs/H3a-subscription/spec.md | 11 file | 15 file | có test |
| WRK-FR-23 | MUST | docs/specs/H1-hub-core/spec.md | 6 file | 6 file | có test |
| WRK-FR-24 | MUST | docs/specs/H1-hub-core/spec.md | 9 file | 7 file | có test |
| WRK-FR-25 | MUST | docs/specs/H1-hub-core/spec.md | 5 file | 2 file | có test |
| WRK-FR-26 | MUST |  | 2 file |  | chưa spec |
| WRK-BR-01 | — |  |  |  | chưa spec |
| WRK-BR-02 | — | docs/specs/H1-hub-core/spec.md | 9 file | 5 file | có test |
| WRK-BR-03 | — |  | 5 file | 2 file | chưa spec |
| WRK-BR-04 | — | docs/specs/H1-hub-core/spec.md | 7 file | 5 file | có test |
| WRK-BR-05 | — | docs/specs/H1-hub-core/spec.md | 2 file | 1 file | có test |
| WRK-BR-07 | — | docs/specs/H1-hub-core/spec.md<br>docs/specs/H2c-attachments/spec.md | 5 file | 17 file | có test |
| WRK-BR-06 | — | docs/specs/H1-hub-core/spec.md<br>docs/specs/H2c-attachments/spec.md | 6 file | 3 file | có test |
| WRK-NFR-01 | — | docs/specs/H1-hub-core/spec.md | 1 file | 1 file | có test |
| WRK-NFR-02 | — | docs/specs/H1-hub-core/spec.md |  |  | có spec |
| WRK-NFR-03 | — | docs/specs/H1-hub-core/spec.md |  |  | có spec |
| WRK-NFR-04 | — | docs/specs/H1-hub-core/spec.md | 6 file | 7 file | có test |
| WRK-NFR-05 | — |  |  |  | chưa spec |
| WRK-NFR-06 | — | docs/specs/H1-hub-core/spec.md | 10 file | 6 file | có test |
