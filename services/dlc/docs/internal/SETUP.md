> **INTERNAL - do not ship to customers.** Full-stack developer setup from the source tree.

# DLC: hướng dẫn setup toàn hệ thống

Mục tiêu: từ một host đã có sẵn (máy chủ hoặc VM, có mạng, có quyền cài phần mềm) tới lúc **bắt đầu được quy trình
DLC cho một dự án mới**. Làm theo thứ tự 0 → 6; mỗi bước có lệnh kiểm tra, xanh rồi mới sang bước sau.

Hệ thống gồm 4 phần:

| Phần | Là gì | Cổng mặc định |
|---|---|---|
| RAG System | Kho tri thức có cấu trúc: event, lease, record, pack, retrieval, worklog, finding của từng dự án | do bản triển khai RAG System quyết định |
| DLC engine (dây chuyền) | `Slaves/SDLC/line`: hiểu spec → feature graph → test → chia việc → build → QAS | 8796 |
| Workflow tool | `Slaves/Workflow`: chạy các process DLC (New System, Enhancement, Bug Fix) | 8790 |
| Frontend | `RITA`: giao diện, đăng nhập Google, nhúng Workflow tool | 8791 |

---

## 0. Chuẩn bị host

| Cần | Ghi chú |
|---|---|
| Windows 10/11 hoặc Windows Server | Frontend lưu thông tin Google SSO bằng DPAPI, chỉ có trên Windows. DLC engine và Workflow tool chạy được cả Linux |
| Python 3.10 trở lên | DLC engine và Workflow tool chỉ dùng thư viện chuẩn |
| Git | DLC engine dùng git worktree cho mỗi unit |
| PowerShell 7 (`pwsh`) | Node shell của Workflow tool và `line/tools/dlc_flow.ps1` chạy bằng `pwsh` |
| Node.js + pnpm | Chỉ để build giao diện Workflow tool và Frontend |
| Claude Code CLI (`claude`) | Model của DLC engine khi `LINE_LLM=cli`. Bản đã kiểm: 2.1.283 |
| Một tài khoản dịch vụ cho dây chuyền | Tài khoản thật trên RAG System (bước 1) và tài khoản đăng nhập `claude` (bước 2) |

Lấy code (monorepo RWorkspace):

```
git clone https://github.com/NghiepHoang91/RWorkspace.git
cd RWorkspace
git checkout sdlc-line          # DLC engine; khi đã merge vào main thì dùng main
```

Workflow tool và 3 flow DLC (`Slaves/Workflow/flows/22..24-dlc-*.json`) nằm trên nhánh tích hợp của RAG System
cho tới khi được merge vào main. Trên host mới, merge cả hai nhánh vào một nhánh triển khai, hoặc chờ cả hai lên main.

Kiểm tra:
```
python --version; git --version; pwsh --version; claude --version
```

---

## 1. RAG System

Triển khai theo tài liệu triển khai của chính RAG System. DLC engine cần ở đó:

| Cần | Để làm gì |
|---|---|
| Capability: events, leases, records, packs + quote, retrieval, metrics, items, worklog | Ghi event có thứ tự, giữ lease, lưu record, đóng băng spec, ngữ cảnh theo key, finding, worklog của dự án |
| Embedder đang chạy | Retrieval theo nghĩa và ghi worklog cần |
| Một **namespace** cho dây chuyền (id chỉ gồm chữ thường, số, `_`; mặc định `sdlc_line`) | Mọi dữ liệu thô của dây chuyền nằm trong namespace này |
| **Client id / client secret** của namespace (cấp kiểu client-credentials) | DLC engine đổi lấy token 15 phút |
| **Tài khoản thật của dây chuyền** (một người dùng, không phải agent) | Tài khoản này tạo dự án mới khi quy trình bắt đầu (bước 6) |

DLC engine KHÔNG tự áp manifest (`line/rag/manifest.py`) khi khởi động. Áp một lần sau khi có namespace và
client (bước 2.2), và áp lại sau mỗi lần nâng cấp engine. Áp lại nhiều lần không đổi gì:

```
python -c "from line.config import load_config; from line.rag.http_adapter import HttpRagAdapter as H; print(H.from_config(load_config(rag='http')).apply_manifest())"
```

Kiểm tra: gọi được endpoint sức khỏe của RAG System từ host DLC, và đổi được client id/secret lấy token.

---

## 2. DLC engine

### 2.1 Đăng nhập model

```
claude login            # chạy dưới tài khoản dịch vụ sẽ chạy DLC engine
```

Dùng một profile riêng cho dây chuyền (`CLAUDE_CONFIG_DIR`), không dùng profile cá nhân. Token kiểu `claude
setup-token` là OAuth, không dùng làm API key. Muốn gọi API trực tiếp thì đặt `LINE_LLM=api` và key của API.

### 2.2 File cấu hình nối RAG System (nằm NGOÀI repo)

`%USERPROFILE%\.line\rag.local.json` (hoặc đường dẫn trong `LINE_RAG_LOCAL`):

```json
{"rag_url": "https://<rag-system-host>", "rag_ns": "sdlc_line", "rag_timeout_s": 15}
```

Secret không bao giờ nằm trong file. Client id/secret chỉ đọc từ biến môi trường `LINE_RAG_CLIENT_ID` và
`LINE_RAG_CLIENT_SECRET`; file có ghi thì bị bỏ qua.

### 2.3 Biến môi trường

| Biến | Giá trị khuyên dùng | Ý nghĩa |
|---|---|---|
| `LINE_LLM` | `cli` | `fake` chỉ dùng cho dry test |
| `LINE_DB` | `D:\dlc\line.db` | SQLite của dây chuyền |
| `LINE_WORKROOT` | `D:\dlc\work` | worktree của các unit |
| `LINE_MAX_USD_RUN` | `6` | trần chi phí một run |
| `LINE_RAG` | `http` | `off` = chạy không có RAG System (chỉ để thử) |
| `LINE_RAG_URL` | URL của RAG System | bắt buộc khi `LINE_RAG=http` (hoặc `rag_url` trong file 2.2); không có giá trị mặc định |
| `LINE_RAG_CLIENT_ID`, `LINE_RAG_CLIENT_SECRET` | từ bước 1 | secret, đặt ở service, không ghi file |
| `LINE_FGRAPH` | `1` | feature graph: build theo thứ tự phụ thuộc, thiếu bên tạo ra thì hỏi |
| `LINE_HUMAN_MODE` | `ask` | `ask`: dừng chờ người trả lời; `decide`: model tự quyết và ghi worklog |
| `LINE_UPLUS` | `1` khi muốn | gap checklist + phát hiện mâu thuẫn |
| `LINE_AUTO_RESUME` | `1` | khởi động lại server thì chạy tiếp các run dở |

Các cờ khác (review, drift, judge, learn, reconcile) mặc định tắt; xem `line/config.py`.

### 2.4 Kiểm tra cài đặt (không tốn tiền)

```
cd Slaves/SDLC
python -m unittest discover -s line/tests -t .        # khoảng 550 test, phải OK
python -m line.e2e.run_line_e2e base fgraph            # dry, model giả, phải PASS
```

### 2.5 Chạy server

```
cd Slaves/SDLC
python -m line.cli serve --resume                      # http://127.0.0.1:8796, board ở /board
```

Chạy dạng service (Task Scheduler / NSSM / systemd) dưới tài khoản dịch vụ, với các biến ở 2.3. Khi chạy từ một
phiên Claude Code, xóa các biến `CLAUDECODE*` / `CLAUDE_CODE_*` của phiên đó trước, để CLI con không tưởng mình
đang lồng trong phiên khác.

Kiểm tra: `GET http://127.0.0.1:8796/api/health` trả `"ok": true, "driver": true`.

### 2.6 Môi trường QAS

Hiện QAS là thư mục local do DLC engine tự deploy (blue/green) và chạy test 3 lần. Chưa có QAS server riêng và
chưa có PRD; đó là việc còn mở.

---

## 3. Workflow tool

```
cd Slaves/Workflow/web
pnpm install
pnpm build                                             # tạo web/dist
cd ..
```

Đặt biến môi trường cho Workflow tool rồi chạy:

| Biến | Giá trị | Ý nghĩa |
|---|---|---|
| `DLC_LINE_DIR` | đường dẫn tới `Slaves/SDLC/line` | nơi có `tools/dlc_flow.ps1`; bỏ trống thì dùng `..\SDLC\line` (monorepo) |
| `DLC_HOME` | ví dụ `D:\dlc` | chứa `packs\` và `targets\` do flow tạo; bỏ trống thì dùng `~/dlc` |
| `DLC_LINE_URL` | `http://127.0.0.1:8796` | địa chỉ DLC engine (mặc định đúng giá trị này) |

```
python workflow.py serve --port 8790
```

Nạp 3 process DLC:

```
python ../SDLC/line/tools/import_dlc_flows.py --url <workflow-tool-url> --dir <thư mục flows của Workflow tool>
```

Kết quả in ra 3 dòng `DLC: New System`, `DLC: Enhancement`, `DLC: Bug Fix` kèm id workflow.

Kiểm tra: chạy flow Enhancement với một `target` không tồn tại; kết quả phải là `outcome: failure` (bước chuẩn bị
từ chối), và không có run nào được tạo trên DLC engine.

---

## 4. Frontend

```
cd RITA
pnpm install
pnpm build
pip install cryptography firebase-admin                # Notes và lưu trữ an toàn
python rita.py serve                                   # http://127.0.0.1:8791
```

Hoặc chạy không cửa sổ bằng `start-rita.vbs`.

- **Google SSO:** tạo OAuth client (scope `openid email profile`), rồi lưu một lần bằng
  `POST /api/auth/credentials {clientId, clientSecret}`. Secret được mã hóa bằng DPAPI theo tài khoản Windows đang
  chạy Frontend. Bất kỳ tài khoản Google nào đăng nhập được thì vào được; không có phân quyền.
- **Workflow tool trong Frontend:** bấm mục **Workflows** thì Frontend tự gắn vào Workflow tool đang chạy ở cổng 8790,
  hoặc tự khởi động nó nếu chưa chạy. Nếu Frontend tự khởi động thì Workflow tool kế thừa biến môi trường của
  Frontend, nên đặt `DLC_LINE_DIR` / `DLC_HOME` cho cả Frontend.

Kiểm tra: đăng nhập Google, mở Workflows, thấy 3 flow DLC.

---

## 5. Kiểm tra toàn tuyến (tốn khoảng 1-2 USD)

Trong Frontend → Workflows → **DLC: New System**, chạy với:

```
name     = Todo CLI
spec     = (để trống)
packPath = <repo>/Slaves/SDLC/line/samples/todo-pack
```

Kết quả mong đợi: flow kết thúc `success` với `state: green`. Board (`http://127.0.0.1:8796/board`) có run 4 unit
merged, QAS xanh. Repo kết quả nằm trong `DLC_HOME\targets\todo-cli-<thời gian>`.

---

## 6. Bắt đầu một dự án mới

1. **Tạo dự án trên RAG System bằng tài khoản thật của dây chuyền**, rồi gắn dự án đó vào namespace của dây chuyền.
   Agent không tự tạo dự án. Dự án dùng lại thì bước nhận việc đọc RAG System và tự chọn dự án có sẵn.
2. Thêm thành viên vào dự án. Người và agent dùng chung worklog và finding của dự án; dữ liệu thô của run thì nằm
   trong namespace.
3. **Viết spec** thành `spec.md` (có thể kèm file `.md` / `.txt` khác):
   - mỗi tính năng một mục `## F1 <tên>`, `## F2 <tên>` ..., dưới đó là các tiêu chí kiểm được (input, output, mã
     thoát, thông báo lỗi viết đúng nguyên văn);
   - nói rõ dữ liệu nào đến từ bên ngoài (người dùng nhập, hệ thống khác). Thiếu chỗ nào thì feature graph sẽ dừng
     lại hỏi thay vì để agent tự bịa.
4. Chạy process trên Frontend:
   - **New System**: `name` + `spec` (dán nội dung) hoặc `packPath`; repo mới được tạo trong `DLC_HOME\targets`.
   - **Enhancement**: `target` (repo có sẵn) + `name` + `spec` của phần thêm mới.
   - **Bug Fix**: `target` + `name`, `title`, `repro`, `expected`, `actual`, `context`.
5. Nếu run dừng chờ câu hỏi (`parked: true`): mở board, trả lời qua `POST /api/runs/<run>/answers`, run tự chạy tiếp.
   Câu trả lời trở thành addendum của spec (`v1.1`, `v1.2` ...).

---

## Việc còn mở (chưa nằm trong bản setup này)

- Chưa có script cài một lệnh; các bước trên làm tay.
- Bước nhận việc chưa tự tạo / tự chọn dự án; bước 6.1 đang làm tay.
- QAS là thư mục local; chưa có QAS server, chưa có PRD, chưa có UAT / Go-No-Go / release.
- Feature graph mới lưu trong DB của dây chuyền; chưa đẩy lên RAG System (phân tích ảnh hưởng cho Enhancement cần
  phần này).
- Frontend chưa có màn trả lời câu hỏi; đang trả lời qua API / board.
