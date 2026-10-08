# CR-052 UAT report (login redesign, rename, EN default) - 2026-10-08

Stack (pre-existing, untouched): admin-web :3000, chat-web :3100, studio-web :3200/studio, admin-api :3001, hub :4000.
Browser: Playwright Chromium, fresh contexts, locale vi-VN, 1440x900 unless noted. Accounts: platform/admin, evolu/thomas.tran, evolu/julian.bui (pw 1234567890).
Scripts: scripts/run.mjs (main), scripts/mock.mjs (mockup shots). Raw results: result.json.

## Results (PASS/FAIL)
| Scenario | Admin | Chat | Studio | Evidence |
|---|---|---|---|---|
| 1 EN default, brand top-left, EN pressed, showcase, no Dify/claude-sub/llm | PASS | PASS | PARTIAL (logo img broken, BUG-1) | 01-{app}-login-en.png |
| 2 VI click + persists after reload | PASS | PASS | PASS | 02-{app}-login-vi(-reload).png |
| 3 1024/1366/375 no h-scroll, mobile showcase hidden | PASS | PASS | PASS (logo broken) | 03-{app}-{size}.png |
| 4 Keyboard order + focus visible | PASS | PASS | PASS | 04-{app}-focus-*.png |
| 5a wrong password -> role=alert | PASS | PASS | PASS | 05-{app}-wrong-pw.png |
| 5b correct login lands on app | PASS (/) | PASS (/c/new) | PASS (/studio/agents) | 05-{app}-after-login.png |
| 6 role gate | PASS (member -> "use Evolu Copilot" page, no link) | n/a | PASS (julian -> Agent Forge wording; button "Back to Chat") | 06-admin-member.png, 06-studio-nonplatform.png |
| 7 renamed names after login | PASS (tab title, "Agent Forge" topbar button) | PASS (tab "Evolu Copilot", header "Evolu Copilot · Evolu") | PASS (sidebar "Agent Forge", "⇄ Evolu Control") | 07-{app}-names.png |
| 8 dark mode | no dark theme (stays light) | FAIL contrast (BUG-2) | no dark theme (stays light) | 08-{app}-dark.png, 08-{app}-app-dark.png |

Details: Login h1 is "Sign in" (Admin, Chat) and "Sign in to Agent Forge" (Studio); VI: "Đăng nhập" / "Đăng nhập Agent Forge". html lang=en. localStorage keys ai.locale / studio.locale: only written on explicit choice (vi), and after login set from user.locale.
Post-login locale: follows /auth/login user.locale. platform admin = en, julian.bui = en, thomas.tran = vi (seed data) -> Chat opened in Vietnamese after login even though the login page was EN. Behaves as designed by CR-052; note the seed has thomas.tran on vi.
No Dify/claude-sub/llm on any login page (text + markup). (The words "Dify" appear in app data after login, e.g. agent "Chatbot (Dify)", "dify-demo" audit rows - not login.)

## Differences vs mockup C (mockup frames are a fixed 1280px, cropped by design, so only layout/text compared)
- Layout, 520px left column, tinted right pane, robot, window mock: match. Window mock is cropped at right/bottom at 1024/1366 like the mockup.
- Admin: mockup h1 "Admin sign in" + subtitle "For platform and company administrators."; real shows "Sign in" + "Use your company code and the account your administrator gave you." Mockup shows "Team member? Open Evolu Copilot" box under the button; real has none (link hidden - see Notes). Real adds "Remembered for next time" hint and a show-password eye icon (not in mockup). Mockup company code prefilled "acme" (just demo).
- Chat: mockup subtitle "Use the account your company gave you." vs real longer text; mockup footer "Forgot your password? Contact your company admin." is absent in real Chat.
- Studio: matches (badge, h1, "Open Evolu Control" link) except logo (BUG-1).
- Headline wraps to 2 lines in mockup at its 1280 frame; real stays 1 line at 1440 (wider pane) - fine.

## Bugs
| # | Sev | App | Steps | Expected / Actual | Evidence |
|---|---|---|---|---|---|
| BUG-1 | Cao | Studio | Open http://localhost:3200/studio/login | Logo icon shown. Actual: broken image; img src is /brand/evoluconsulting-icon.svg (404) - missing the /studio base path (/studio/brand/... returns 200). Same for any page using that logo. | 01-studio-login-en.png |
| BUG-2 | Cao | Chat | Context colorScheme dark, open /login | Readable headline. Actual: right-pane headline is dark indigo on dark indigo (near invisible); subtitle OK. | 08-chat-dark.png |
| BUG-3 | Thường | Admin, Studio | colorScheme dark | Dark login or documented as unsupported. Actual: both stay fully light (Chat has a dark theme) - inconsistent across apps; no readability problem. | 08-admin-dark.png, 08-studio-dark.png |
| BUG-4 | Thường | Admin | Login as thomas.tran (member) | "Use Evolu Copilot" page offers an "Open Evolu Copilot" link. Actual: only "Đổi mật khẩu"/"Đăng xuất"; no link (probably CHAT URL env not set in dev). Same for login page "Team member? Open Evolu Copilot" and Admin overview "Open Agent Forge" (disabled, "Available once Agent Hub is ready") while Studio's "Open Evolu Control" and "⇄ Evolu Control" links do show. Report-only: verify config. | 06-admin-member.png, 07-admin-names.png |
| BUG-5 | Thấp | Studio | julian.bui login | Cross-link name per CR-052: forbidden page button says "Back to Chat", should likely read "Open Evolu Copilot". | 06-studio-nonplatform.png |
| BUG-6 | Thấp | Admin | After login, sidebar top-left | Old wordmark image "EvoluConsulting" tiny text beside icon, not the new "Evolu Control" name (rename in logo not applied in shell sidebar). Studio/Chat shells use the text name. | 07-admin-names.png |
| BUG-7 | Thấp | all | 1024x768 | Page scrolls vertically (scrollHeight 813-848 > 768) and footer (c) is clipped below the fold in Studio; no horizontal overflow. | 03-studio-1024x768.png |

## Notes / limits
- Keyboard order identical in all 3: EN, VI, company, username, password, (show-password in Admin), submit; focus shows as box-shadow ring (outline none) - visible; submit has 3px ring.
- 375px: showcase hidden, form usable, scrollWidth == innerWidth in all apps.
- Dark mode checked via emulated prefers-color-scheme only.
- No 2FA/TOTP flow exercised.
