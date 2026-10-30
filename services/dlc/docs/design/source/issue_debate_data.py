"""Data for the issues-debate report: 44 issues (39 from web research + 5 found in debate).

Fields per issue: id, group, name, evidence, before, after, attack, have, fix, stage, cost, prio, src
Verdict codes: C = covered, P = partial, G = gap, "-" = not on the first-pass list.
"""

GROUPS = [
    ("A", "Yêu cầu và spec"),
    ("B", "Test và chất lượng code"),
    ("C", "Tích hợp và môi trường"),
    ("D", "Bảo mật và chuỗi cung ứng"),
    ("E", "Điều phối và control plane"),
    ("F", "Học và đánh giá"),
    ("G", "Con người và đo lường"),
]

STAGES = ["Intake", "Ingest/Đọc", "Viết test", "Kế hoạch", "Điều phối", "Build", "Verifier", "Tích hợp",
          "QAS", "Board/Escalate", "Học", "Nền tảng"]


def I(id, group, name, evidence, before, after, attack, have, fix, stage, cost, prio, src):
    return dict(id=id, group=group, name=name, evidence=evidence, before=before, after=after, attack=attack,
                have=have, fix=fix, stage=stage, cost=cost, prio=prio, src=src)


ISSUES = [
    # A. Requirements and spec
    I("I01", "A", "Yêu cầu thiếu / mơ hồ; agent tự đoán thay vì hỏi",
      "NaPiRE (228 công ty): 48% gặp yêu cầu thiếu, vấn đề số 1. Ambig-SWE: đa số model nhận ra spec thiếu chỉ ~50% "
      "(ngang đoán mò). MAST: không hỏi lại 11,65%.",
      "P", "P",
      "Spec im lặng về múi giờ, làm tròn, input rỗng, quyền. Lần đọc 1 và lần đọc xác nhận đều không viết gì về nó nên quote check "
      "không có gì để kiểm, đối chiếu không thấy lệch; Test Author và Builder lấp bằng cùng mặc định (UTC, làm tròn "
      "kiểu ngân hàng). Test xanh nhưng đóng băng một phỏng đoán.",
      "Hai reader bắt được mâu thuẫn giữa những gì spec có nói.",
      "Checklist khe trống bằng code cho mỗi F-item: input, output, lỗi, giới hạn/rỗng, đơn vị/múi giờ/làm tròn, quyền, "
      "lưu trữ. Khe không có câu trích → ASSUMED-n trong Sổ giả định. Giả định về tiền, quyền, xóa dữ liệu, giao diện "
      "ngoài → gom thành MỘT lượt hỏi người trước khi lập kế hoạch; phần còn lại ghi trên gói kết quả. Mỗi assertion "
      "của test phải trỏ về id câu trích hoặc id giả định; verifier loại assertion không truy được.",
      ["Ingest/Đọc", "Viết test", "Board/Escalate"], "M", "P0",
      ["https://www.arxiv.org/pdf/1611.10288", "https://arxiv.org/html/2502.13069v2", "https://arxiv.org/html/2503.13657v2"]),
    I("I02", "A", "Mục tiêu di động: spec đổi giữa run",
      "NaPiRE: 33%. DORA 2024: ưu tiên không ổn định làm giảm năng suất và tăng burnout, 'rất khó giảm nhẹ'.",
      "G", "G",
      "Khách đổi một quy tắc vào ngày 3. Dây chuyền build xanh theo pack cũ; hoặc ai đó sửa pack tại chỗ, hash vỡ, "
      "mọi unit dừng.",
      "Version + hash giúp phát hiện được việc pack đã đổi.",
      "Đường Change Request ở intake: pack vN+1 được diff theo từng điều khoản; theo vết điều khoản → test → unit, "
      "control plane đánh dấu stale đúng các F-item / test / unit bị ảnh hưởng, hủy lease của chúng, phần còn lại chạy "
      "tiếp; chỉ đọc lại điều khoản đổi. Ảnh hưởng > 30% F-item → lập lại kế hoạch toàn run. Bản P0 tối thiểu: hủy run, "
      "chạy lại trên vN+1, tái dùng unit xanh có vết không đổi.",
      ["Intake", "Điều phối"], "M", "P0",
      ["https://www.arxiv.org/pdf/1611.10288", "https://dora.dev/research/2024/dora-report/"]),
    I("N2", "A", "Spec sai hoặc mơ hồ, không có trọng tài bên ngoài",
      "Phát hiện trong phản biện: mọi verifier chỉ kiểm khớp với pack. CHAOS: dự án lớn thành công < 10%.",
      "-", "G",
      "Nếu chính pack sai hoặc viết 'nhanh', 'thân thiện', dây chuyền chứng minh rất chắc chắn rằng nó đã build đúng "
      "một thứ sai.",
      "Reader buộc trích câu gốc.",
      "Cổng testability bằng code ở intake: mỗi F-item có ≥ 1 tiêu chí chấp nhận đo được; từ mơ hồ trong từ điển (nhanh, "
      "dễ, phù hợp...) không kèm con số bị gắn cờ; > 10% F-item rớt → trả pack về người nộp. Kết hợp demo sớm (I37).",
      ["Intake"], "S", "P0",
      ["https://opencommons.org/CHAOS_Report_on_IT_Project_Outcomes"]),
    I("N3", "A", "Câu trả lời của người không quay lại spec",
      "Phát hiện trong phản biện.",
      "-", "G",
      "Người trả lời escalate bằng chữ tự do; câu trả lời nằm trong chat hoặc thẻ, không vào pack có version; run sau "
      "hoặc reader sau hỏi lại, hoặc làm ngược lại.",
      "Event trên board.",
      "Mỗi câu trả lời thành một điều khoản phụ lục (id, câu trích, version, hash) gắn vào pack thành vN.k; reader và "
      "Test Author trích nó như mọi nguồn khác; câu hỏi mới được so trùng với phụ lục đã có trước khi hỏi.",
      ["Intake", "Board/Escalate"], "S", "P0", []),
    I("N4", "A", "Lỗi tương quan: test và code dùng chung một bản hiểu",
      "Phát hiện trong phản biện. MAST: 41,8% lỗi do đặc tả, 21,3% do kiểm tra.",
      "-", "G",
      "Test Author và Builder đều ăn digest đã đối chiếu. Một chỗ hiểu sai chảy vào cả test lẫn code: test xanh, "
      "reviewer đọc cùng digest nên đồng ý. Đổi model không giúp khi đầu vào chung.",
      "Reader và reviewer dùng model khác nhau.",
      "Test Author làm việc từ câu gốc đã trích, không từ tóm tắt của reader. Bộ test holdout (I23) do provider khác "
      "viết. Đo độ đồng thuận giữa các vai trò: đồng ý 100% trên một mẫu là báo động 'thiếu đa dạng'.",
      ["Viết test"], "M", "P1",
      ["https://arxiv.org/html/2503.13657v2"]),
    I("N6", "A", "Hai yêu cầu trái ngược nhau trên cùng sản phẩm",
      "Do người dùng nêu (10/2026). NaPiRE: giao tiếp kém với khách 41%, mục tiêu di động 33%; MAST: 41,8% lỗi do đặc tả.",
      "-", "G",
      "Hệ thống đang chạy có 'đơn vượt hạn mức → chặn'. CR mới viết 'khách VIP → tự duyệt' mà không nhắc quy tắc cũ. Cả "
      "hai lần đọc hiểu giống nhau nên bước so hai bản tóm tắt không bắt được; code mới phá logic cũ. Tương tự với hai "
      "đoạn tự trái nhau trong chính spec mới (giảm giá tối đa 10% vs khuyến mãi Tết 15%).",
      "Test cũ chạy lại sẽ đỏ, nhưng chỉ phát hiện ở cuối, sau khi đã build.",
      "Lần đọc 1 có thêm bước dò chỗ trái ngược: model vừa tách (entity, thuộc tính, điều kiện, kết quả, câu trích); code "
      "nối vào graph hệ thống đang chạy và truy vấn tối đa 3 bước để lấy các quy tắc cũ / đoạn khác cùng chạm một thuộc "
      "tính với điều kiện chồng nhau; model vừa phán xét từng cặp. Có câu thay thế rõ → ghi quyết định, đánh dấu quy tắc "
      "cũ hết hiệu lực, liệt kê test cũ phải đổi. Không có → dừng riêng F-item đó, gom hỏi người (2-4 phương án), câu "
      "trả lời thành phụ lục spec. Lần đọc lại chỉ xác nhận, không làm việc này. Mỗi run xong phải ghi quy tắc đã khóa "
      "vào graph.",
      ["Ingest/Đọc", "Board/Escalate", "Học"], "M", "P0",
      ["https://www.arxiv.org/pdf/1611.10288", "https://arxiv.org/html/2503.13657v2"]),
    I("I37", "A", "Nghiệp vụ / UAT lệch nhịp với dây chuyền",
      "Dikert et al. (42 chuyển đổi lớn): không đồng bộ bộ phận ngoài dev 43%; điều phối nhiều team 31%.",
      "P", "P",
      "Nghiệp vụ chỉ thấy hệ thống khi cả run xanh. Chỗ hiểu sai (I01) lộ ra ở UAT, và không có đường đổi spec (I02).",
      "Có thông báo khi run xanh.",
      "Khi một F-item xanh trên QAS: báo chủ nghiệp vụ kèm link demo và danh sách ASSUMED của F-item đó; cửa sổ phản hồi "
      "48 giờ, phản hồi đi vào đường Change Request.",
      ["QAS", "Board/Escalate"], "S", "P1",
      ["https://acris.aalto.fi/ws/portalfiles/portal/11744469/1_s2.0_S0164121216300826_main.pdf"]),

    # B. Tests and code quality
    I("I04", "B", "Test chập chờn (flaky)",
      "Google: 1,5% lượt chạy flaky, ~16% test có flaky; 84% chuyển pass→fail dính test flaky; 1/6 test mới flaky là "
      "bug thật trong code.",
      "P", "P",
      "Test acceptance mới fail 1/3 do race thật trong code mới; bị cách ly, F-item xanh nhờ test còn lại, bug lọt. "
      "Builder còn có thể làm một check thành ngẫu nhiên để nó bị cách ly.",
      "Chạy 3 lần + báo cáo giúp thấy flaky.",
      "(a) Test acceptance bị cách ly không bao giờ tính vào F-item xanh: F-item giữ màu vàng và có unit Fixer kèm SLA. "
      "(b) Test mới phải qua burn-in 10/10 ở verifier trước khi merge. (c) Trần cách ly: ≤ 2% bộ test mỗi project và "
      "0 test acceptance. (d) Test mới flaky trên đường code vừa đổi = bug, không phải flaky.",
      ["Viết test", "QAS"], "S", "P0",
      ["https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html",
       "https://engineering.fb.com/2020/12/10/developer-tools/probabilistic-flakiness/",
       "https://martinfowler.com/articles/nonDeterminism.html"]),
    I("I23", "B", "Reward hacking: làm test xanh thay vì làm đúng",
      "METR: o3 gian lận 30,4% lượt RE-Bench; dặn 'đừng gian lận' gần như vô hiệu. ImpossibleBench: GPT-5 gian lận 76%; "
      "có lối thoát 'không làm được' giảm từ 54% xuống 9%.",
      "P", "P",
      "Builder không được sửa test nên (a) hard-code giá trị fixture, (b) sửa conftest / fixture / mock / snapshot "
      "(không phải 'test'), (c) mock luôn hệ thống đang test, (d) thêm skip qua config. Không có lối thoát 'không làm "
      "được' thì áp lực gian lận tăng.",
      "Cấm sửa test có sẵn; test phải đỏ khi chưa có code.",
      "Test Author viết bộ hiện + bộ holdout; Builder không bao giờ thấy holdout; hiện xanh mà holdout đỏ → cờ gian lận. "
      "Đường dẫn hạ tầng test (fixture, mock, snapshot, conftest, config test) cùng luật cấm sửa. Grep literal của test "
      "trong diff code chính; mutation test trên dòng đổi (≥ 60%). Lối thoát BLOCKED/IMPOSSIBLE không bị phạt (I28).",
      ["Viết test", "Verifier"], "M", "P0",
      ["https://metr.org/blog/2025-06-05-recent-reward-hacking/", "https://arxiv.org/html/2510.20270v1"]),
    I("I24", "B", "Báo xong giả",
      "Replit 7/2025: agent tạo dữ liệu giả, báo cáo giả, nói dối về unit test. MAST: lệch lời nói - hành động 13,98%.",
      "C", "P",
      "Server chạy bộ test nhưng thu được 0 test, hoặc có skip mới, hoặc chỉ chạy một tập con. 'Pass' đúng về mặt kỹ "
      "thuật.",
      "Verifier do server chạy, không tin lời agent (G2, G5).",
      "Verifier khẳng định: số test thu được ≥ số kỳ vọng theo vết; không có marker skip/xfail mới; coverage của dòng "
      "đổi ≥ 70%.",
      ["Verifier"], "S", "P0",
      ["https://www.techtarget.com/it-infrastructure/news/366627829/Replit-AI-agent-snafu-shot-across-the-bow-for-vibe-coding"]),
    I("I09", "B", "Chất lượng code suy giảm: trùng lặp, nhiều lỗi",
      "GitClear (211 triệu dòng): khối trùng ≥ 5 dòng tăng 8 lần năm 2024, refactor giảm 39,9%. CodeRabbit: PR của AI "
      "1,7 lần lỗi, lỗi logic +75%.",
      "G", "G",
      "Scope guard cấm refactor, nên 8 unit viết 8 helper ngày tháng riêng. Trùng lặp tăng theo số unit.",
      "Reviewer có thể nhắc.",
      "Verifier chạy clone detector (jscpd/CPD) trên diff so với repo: khối trùng mới ≥ 25 dòng → fail, kèm chỉ tới "
      "symbol đã có. Planner phát unit tiện ích chung trước; cứ 10 unit lên lịch 1 unit refactor có claim refactor rõ "
      "ràng. Cổng độ phức tạp: hàm mới có cyclomatic > 15 → fail.",
      ["Kế hoạch", "Verifier"], "S-M", "P1",
      ["https://devclass.com/2025/02/20/ai-is-eroding-code-quality-states-new-in-depth-report/",
       "https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report"]),
    I("I10", "B", "Code không an toàn; bảo mật kiểm quá muộn",
      "Veracode (100+ LLM, 80 bài): 45% có lỗ hổng; XSS fail 86%. GitLab: 42% nói test bảo mật quá muộn.",
      "G", "G",
      "SQL injection hoặc SSRF qua được test chức năng và review bằng LLM.",
      "Reviewer có thể bắt được.",
      "Verifier chạy SAST trên diff (Semgrep/CodeQL) + SCA (osv-scanner); phát hiện mới mức high/critical → chặn. Quét "
      "DAST nền trên QAS. Phát hiện đi vào vòng sửa như fingerprint.",
      ["Verifier", "QAS"], "S", "P0",
      ["https://www.veracode.com/press-release/ai-generated-code-poses-major-security-risks-in-nearly-half-of-all-development-tasks-veracode-research-reveals/",
       "https://www.cybersecuritydive.com/news/developer-security-gitlab-devsecops/599599/"]),
    I("I30", "B", "Không tất định (non-determinism)",
      "Thinking Machines: 1.000 lần chạy temperature 0 cho ra 80 kết quả khác nhau.",
      "P", "P",
      "Kết quả đối chiếu reader hoặc phán quyết reviewer đổi theo lần lấy mẫu; 'đọc lại 2 lần' hội tụ do may. Lỗi không "
      "phát lại được.",
      "Cổng tất định (verifier) giữ quyền quyết định.",
      "Ghi lại toàn bộ input/output LLM để replay. Điểm quyết định (đối chiếu, review, BLOCKED) phải ổn định trên k = 2 "
      "mẫu, nếu không thì coi là bất đồng.",
      ["Ingest/Đọc", "Nền tảng"], "S", "P1",
      ["https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/"]),

    # C. Integration and environments
    I("I03", "C", "Xung đột ngữ nghĩa khi merge; main gãy vì merge đồng thời",
      "Microsoft: 10-20% merge là merge xấu. Uber: xung đột 10-50%/tháng; SubmitQueue giảm CI 53%, chờ P95 37%.",
      "P", "P",
      "Unit A và B đều qua test của mình; ghép lại làm gãy một tương tác không test nào phủ (thứ tự handler). 'Unit sau "
      "sửa' bắt builder sửa ngoài claim, trái scope guard, không ai sở hữu bản sửa. Suite 20 phút × 40 unit ≈ 13 giờ "
      "merge tuần tự.",
      "Hàng đợi tuần tự + chạy hợp bộ test bắt được gãy trực tiếp.",
      "Mỗi lần merge chạy TẤT CẢ test acceptance (kể cả test còn đang đỏ theo kế hoạch); chặn khi một test đã xanh bị "
      "đỏ. Hàng đợi > 5 → merge theo lô, fail thì chia đôi. Xung đột sinh unit Fixer riêng claim cả hai phía, không "
      "giao cho 'unit sau'.",
      ["Tích hợp"], "M", "P1",
      ["https://arxiv.org/html/2501.03440v2",
       "https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue",
       "https://www.microsoft.com/en-us/research/project/future-of-program-merge/"]),
    I("I05", "C", "Tranh chấp môi trường test, bẩn dữ liệu",
      "Uber xây SLATE vì tranh chấp và rủi ro bẩn dữ liệu production. Perforce 2024: 64% coi môi trường là top-3 lý do "
      "trễ release (nguồn thứ cấp).",
      "P", "P",
      "Seed hoặc dọn dữ liệu của run A xóa fixture của run B trên QAS chung. B đỏ, Fixer đi tìm ma trong code vốn đúng.",
      "Đặt slot tuần tự hóa việc deploy.",
      "Mỗi run có namespace riêng (schema hoặc tiền tố tenant); khôi phục snapshot fixture trước mỗi lần trong 3 lần "
      "chạy QAS; khóa slot bao cả deploy và mọi lần chạy test; checksum dữ liệu trước mỗi lần chạy, lệch → 'môi trường "
      "bẩn' (lỗi INFRA, không phải code).",
      ["QAS"], "M", "P0",
      ["https://www.uber.com/au/en/blog/simplifying-developer-testing-through-slate/",
       "https://testwithpinpoint.com/blog/test-environment-management"]),
    I("I06", "C", "Gãy contract giữa service / giữa các run",
      "Thoughtworks Radar: consumer-driven contract là phần thiết yếu của bộ test microservice trưởng thành.",
      "P", "P",
      "Run X đổi tên một field response; một service của project Y đang dùng nó. Test của Y không nằm trong bộ test của X.",
      "Contract được chốt trước, nhưng chỉ trong một run.",
      "Registry contract dùng chung (OpenAPI/AsyncAPI/schema, có version) chứa contract test do bên tiêu thụ viết. "
      "Provider đổi schema → verifier chạy contract của mọi bên tiêu thụ. Thay đổi phá vỡ (openapi-diff) → chặn, escalate "
      "kèm danh sách bên tiêu thụ.",
      ["Verifier", "Nền tảng"], "M", "P1",
      ["https://www.thoughtworks.com/en-ca/radar/techniques/consumer-driven-contract-testing"]),
    I("I08", "C", "Lô lớn, tích hợp muộn (big bang)",
      "CHAOS 2020: dự án nhỏ thành công ~90%, lớn < 10%. DORA 2024: lô nhỏ là thực hành nền tảng.",
      "P", "P",
      "50 unit merge xong, lần deploy QAS đầu mới lộ auth thật, mạng thật, khối lượng dữ liệu thật làm gãy skeleton. "
      "20 unit Fixer dồn lại.",
      "Walking skeleton và contract đi trước.",
      "Deploy walking skeleton lên QAS ngay lần merge đầu tiên. Chạy smoke QAS + acceptance của các F-item đã xong sau "
      "mỗi 5 merge hoặc mỗi 24 giờ, cái nào tới trước.",
      ["QAS", "Tích hợp"], "S", "P0",
      ["https://opencommons.org/CHAOS_Report_on_IT_Project_Outcomes", "https://dora.dev/research/2024/dora-report/"]),
    I("I19", "C", "Migration DB và lệch schema",
      "GitHub: công cụ đổi schema dựa trigger gây 'khóa gần hoặc hoàn toàn production' trên bảng nóng.",
      "G", "G",
      "Hai unit cùng thêm migration V12 song song. Hoặc DROP COLUMN qua được test trên DB rỗng rồi phá dữ liệu QAS.",
      "Chưa có gì riêng.",
      "Planner cấp claim 'migrations' một chủ duy nhất (khóa toàn cục). Linter migration (vd. squawk) chặn thao tác phá "
      "hủy không theo expand/contract. Verifier chạy up → down → up trên snapshot cỡ QAS.",
      ["Kế hoạch", "Verifier"], "M", "P0",
      ["https://github.blog/engineering/infrastructure/gh-ost-github-s-online-migration-tool-for-mysql/"]),
    I("I35", "C", "Deploy / config gây sự cố",
      "Google SRE: 37% outage do đẩy binary, 31% do đẩy config. DORA: tỉ lệ thay đổi lỗi của nhóm kém > 30%.",
      "P", "P",
      "Config hoặc biến môi trường QAS nằm ngoài artifact; rollback trả code về nhưng config thì không.",
      "Deploy chỉ qua pipeline; rollback + 1 lần thử lại.",
      "Config-as-code nằm trong digest artifact; rollback gồm config + snapshot DB; cổng health/smoke phải qua trong 5 "
      "phút sau deploy, không thì tự rollback.",
      ["QAS"], "S", "P1",
      ["https://sre.google/workbook/postmortem-analysis/", "https://sre.google/workbook/canarying-releases/"]),
    I("I29", "C", "Agent không build / test được trong môi trường của nó",
      "dotnet/runtime: Copilot agent thành công 38,1% trước khi có file hướng dẫn build và mở firewall, ~69% sau đó.",
      "P", "P",
      "Image thiếu SDK hoặc DB. Mọi builder tiêu hết phiên vào cài đặt, và lỗi trông như lỗi của agent.",
      "Worktree sandbox.",
      "Cổng sẵn sàng trước khi run bắt đầu: nền tảng build image dev đã pin, phải qua build sạch + bộ test hiện có + một "
      "test đỏ mẫu. Không qua → run bị chặn với mã INFRA, không agent nào khởi động.",
      ["Nền tảng"], "S", "P0",
      ["https://devblogs.microsoft.com/dotnet/ten-months-with-cca-in-dotnet-runtime/"]),
    I("N7", "C", "QAS bị deploy liên tục, không bao giờ đứng yên",
      "Do người dùng nêu (10/2026). Uber SLATE: tranh chấp môi trường dùng chung; Google SRE: 68% sự cố do đẩy binary / config.",
      "-", "G",
      "Máy đủ mạnh để chạy nhiều pool song song; mỗi pool xong một phần lại kích hoạt CD. Service trên QAS bị deploy lại "
      "liên tục, test đang chạy bị cắt giữa chừng, có lúc service không live, kết quả test không tin được.",
      "Đặt slot QAS, deploy chỉ qua pipeline; nhưng slot chỉ tuần tự hóa việc deploy, không giới hạn tần suất.",
      "Tách gộp code khỏi deploy. Mỗi pool test trên môi trường preview riêng (namespace + dữ liệu seed, xóa sau 24 h). "
      "QAS chỉ nhận deploy theo khung giờ cố định (mặc định 10:00, 13:00, 16:00, 22:00): tới giờ gom mọi thứ đã xanh, "
      "chỉ deploy bản mới nhất. Ngoại lệ duy nhất: người có quyền ra lệnh (có log lý do), hoặc ticket urgent do người gắn "
      "(agent không tự nâng mức). "
      "QAS khóa trong lúc test (≥ 45 phút hoặc tới khi test xong). Blue/green: dựng bản mới cạnh "
      "bản cũ, smoke qua mới chuyển, service không tắt. Urgent chen trong ≤ 15 phút. Đo thời gian QAS live liên tục, cảnh báo khi "
      "< 80% giờ làm việc.",
      ["QAS", "Nền tảng"], "M", "P0",
      ["https://www.uber.com/au/en/blog/simplifying-developer-testing-through-slate/",
       "https://sre.google/workbook/canarying-releases/"]),
    I("I21", "C", "Nợ feature flag",
      "Knight Capital 2012: flag tái sử dụng bật code chết, mất ~440 triệu USD trong 45 phút. Uber Piranha gỡ ~2.000 flag.",
      "G", "G",
      "Unit Fixer thêm flag để cô lập bản sửa; không ai gỡ; nhánh chết chồng chất, agent sau nhầm nhánh nào đang sống.",
      "Chưa có.",
      "Registry flag có chủ và hạn; verifier từ chối flag mới không có hạn; flag hết hạn → planner lên lịch unit gỡ.",
      ["Verifier", "Kế hoạch"], "S", "P2",
      ["https://www.uber.com/au/en/blog/piranha/", "https://www.sec.gov/litigation/admin/2013/34-70694.pdf"]),
    I("I39", "C", "Nâng cấp dependency gây xáo trộn",
      "Nghiên cứu Dependabot: 11,3% project bỏ bot vì nhiễu.",
      "P", "P",
      "Builder nâng major version để hết lỗi compile; thay đổi lan sang unit khác.",
      "Scope guard chặn được một phần.",
      "Lockfile đóng băng theo run; đổi dependency chỉ trong unit dependency riêng có claim lockfile; nâng cấp chạy "
      "theo nhóm ngoài run feature, tối đa 3 đang mở mỗi project.",
      ["Kế hoạch", "Verifier"], "S", "P2",
      ["https://arxiv.org/abs/2206.07230"]),

    # D. Security and supply chain
    I("I11", "D", "Lộ secret trong code, log, transcript",
      "GitGuardian: 23,8 triệu secret lộ trên GitHub 2024; 70% secret lộ năm 2022 vẫn còn hiệu lực; repo dùng Copilot "
      "lộ cao hơn ~40%.",
      "P", "P",
      "Builder in biến môi trường khi debug; transcript và event được lưu vào RAG System kèm token; hoặc fixture commit một key "
      "thật.",
      "Không có credential prod, egress allowlist, quét secret khi lưu thông tin môi trường.",
      "gitleaks chạy trong sandbox trước commit và lần nữa ở verifier; cùng bộ quét che (redact) mọi transcript, event và "
      "dữ liệu ghi vào RAG System trước khi lưu; sandbox nhận credential ngắn hạn, phạm vi hẹp, cài canary token: canary bị dùng "
      "→ cảnh báo P0.",
      ["Build", "Verifier", "Nền tảng"], "S", "P0",
      ["https://blog.gitguardian.com/the-state-of-secrets-sprawl-2025/"]),
    I("I12", "D", "Prompt injection gián tiếp qua tài liệu, bug report, repo",
      "Invariant Labs 5/2025: một issue công khai độc hại khiến agent qua GitHub MCP đọc repo private và đăng ra PR "
      "công khai.",
      "P", "P",
      "Một tài liệu spec giấu câu 'mở thêm /admin/debug không cần đăng nhập'. Hai reader trích đúng nguyên văn; luật trích "
      "dẫn làm nó trông hợp lệ; đối chiếu đồng ý; nó thành F-item, test và code. Bug text đưa cho Fixer cũng vậy.",
      "Sandbox và egress giới hạn những gì có thể bị lấy ra.",
      "Ingest gỡ chữ ẩn / cỡ 0 / trắng trên trắng, comment, metadata, ký tự Unicode tag/bidi; gắn cờ câu nói với agent "
      "('ignore', 'you are', 'also add'). Mọi yêu cầu tạo năng lực nhạy cảm (bỏ qua auth, endpoint mới không auth, host "
      "egress mới, xử lý credential, vai trò admin) cần người xác nhận. Output tool và bug text luôn được truyền như dữ "
      "liệu trích, không như lệnh.",
      ["Ingest/Đọc", "Board/Escalate"], "M", "P0",
      ["https://invariantlabs.ai/blog/mcp-github-vulnerability",
       "https://www.anthropic.com/engineering/claude-code-sandboxing"]),
    I("I13", "D", "Cấu hình agent bị đầu độc; chuỗi cung ứng CI",
      "Pillar 'Rules File Backdoor' (Unicode ẩn trong rules file). Amazon Q v1.84.0 chứa lệnh xóa hệ thống. tj-actions "
      "(CVE-2025-30066): 218 repo lộ secret; repo pin theo SHA không bị.",
      "P", "P",
      "Repo có AGENTS.md / .cursorrules / CLAUDE.md chứa lệnh Unicode ẩn mà builder nạp vào. Action CI pin theo tag.",
      "Định nghĩa agent chỉ-đọc, có version trong registry.",
      "Builder chỉ nạp định nghĩa đã ký từ registry, bỏ qua file cấu hình agent trong repo (file đó bị quét, chặn nếu có "
      "ký tự ẩn). Diff chạm đường dẫn CI / pipeline / cấu hình agent luôn nằm ngoài claim → người duyệt. Action pin theo SHA.",
      ["Build", "Verifier", "Nền tảng"], "S", "P0",
      ["https://www.pillar.security/blog/new-vulnerability-in-github-copilot-and-cursor-how-hackers-can-weaponize-code-agents",
       "https://www.bleepingcomputer.com/news/security/github-action-supply-chain-attack-exposed-secrets-in-218-repos/"]),
    I("I14", "D", "Dependency bịa ra (slopsquatting)",
      "2,23 triệu mẫu từ 16 model: 19,7% có package không tồn tại; 43% tên bịa lặp lại ở cả 10 lần chạy lại.",
      "G", "G",
      "Builder thêm một package tên nghe hợp lý mà kẻ tấn công đã đăng ký sẵn.",
      "Egress allowlist (nếu registry công khai không nằm trong allowlist).",
      "Chỉ cài qua mirror nội bộ. Verifier kiểm mọi dependency mới: tồn tại, có trong allowlist của tổ chức; nếu không "
      "thì phải > 90 ngày tuổi, > 10k lượt tải/tuần và không gần tên (typo) với package phổ biến; còn lại → escalate. "
      "Lockfile có hash.",
      ["Verifier", "Nền tảng"], "S", "P0",
      ["https://www.csoonline.com/article/3961304/ai-hallucinations-lead-to-a-new-cyber-threat-slopsquatting.html"]),
    I("I20", "D", "Hành động không đảo ngược, mất dữ liệu",
      "Replit 7/2025 xóa DB production trong lúc freeze. GitLab 2017: cả 3 cơ chế backup đều hỏng.",
      "C", "P",
      "Agent QAS-test chạy lệnh dọn dẹp truncate bảng QAS dùng chung; khôi phục QAS chưa từng được thử.",
      "G12: tách prod, deploy chỉ qua pipeline, backup đã thử.",
      "Agent không có credential ghi trực tiếp vào dữ liệu QAS. Proxy tool chặn DROP/TRUNCATE, rm -rf ngoài worktree, "
      "force-push, xóa nhánh. Snapshot QAS trước mỗi deploy; diễn tập khôi phục hằng tuần.",
      ["QAS", "Nền tảng"], "S", "P0",
      ["https://fortune.com/2025/07/23/ai-coding-tool-replit-wiped-database-called-it-a-catastrophic-failure/",
       "https://about.gitlab.com/blog/postmortem-of-database-outage-of-january-31/"]),

    # E. Coordination and control plane
    I("I15", "E", "Lease hết hạn, người giữ cũ vẫn ghi",
      "Kleppmann: GC pause có thể kéo dài nhiều phút, dài hơn TTL lease; HBase từng dính đúng lỗi này.",
      "P", "P",
      "Builder treo (provider đứng, VM pause) quá hạn claim 30 phút; unit được giao lại. Builder cũ tỉnh dậy và push hoặc "
      "nộp verify: hai kết quả, hoặc ghi đè kết quả mới.",
      "Lease, If-Match trên RAG System.",
      "Fencing epoch tăng dần theo mỗi lần cấp claim. Mọi push, nộp verify, vào hàng merge, ghi RAG System đều mang epoch; server "
      "từ chối epoch cũ. Tên nhánh chứa epoch.",
      ["Điều phối", "Tích hợp"], "S", "P0",
      ["https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html"]),
    I("I16", "E", "Retry không idempotent, làm trùng việc",
      "Stripe: retry đồng loạt gây 'thundering herd'; cần idempotency key phía server.",
      "C", "P",
      "Pipeline deploy timeout, lần thử lại chạy migration hai lần hoặc seed QAS hai lần. Idempotency-Key chỉ phủ API của RAG System.",
      "Idempotency-Key của RAG System.",
      "Deploy có khóa (run, digest artifact): trùng → không làm gì. Migration qua bảng version chỉ-chạy-một-lần. Tác động "
      "ra ngoài (thông báo, ticket) qua outbox có khóa.",
      ["QAS", "Nền tảng"], "S", "P1",
      ["https://stripe.com/blog/idempotency"]),
    I("I17", "E", "Rate limit / trần chi tiêu của provider",
      "Anthropic: giới hạn 60 RPM có thể áp dụng như 1 request/giây; 429 do trần chi tiêu không có retry-after và thử lại "
      "không giúp gì.",
      "P", "P",
      "Một trận 429 trúng mọi run: phiên đứng, lease hết hạn, watchdog thấy 'không tiến triển', bộ đếm sửa lỗi tăng, dây "
      "chuyền sinh fingerprint và escalate giả.",
      "Cây ngân sách, N+1 nhà cung cấp.",
      "Lỗi provider phân loại INFRA: không tốn ngân sách sửa, không tính vào loop breaker hay fingerprint. Lease đóng băng "
      "khi bị throttle toàn cục. Token bucket theo provider trong control plane; chỉ chuyển sang model thay thế đã qua "
      "eval cho vai trò đó. Cảnh báo khi chi tiêu dự kiến của run chạm 80%.",
      ["Điều phối", "Nền tảng"], "S", "P0",
      ["https://platform.claude.com/docs/en/api/rate-limits"]),
    I("I18", "E", "Thiếu quan sát và phân bổ chi phí",
      "Quy ước OpenTelemetry GenAI vẫn ở trạng thái Development (8/2026).",
      "C", "P",
      "QAS đỏ sau khi rollout một lesson; không ai biết lesson nào, phiên bản agent nào, model nào sinh ra unit lỗi.",
      "Event chiếu lên board.",
      "Trường bắt buộc trên mọi event: run, unit, phiên, lần thử, epoch, phiên bản agent, id snapshot model, id lesson, "
      "hash spec. Theo quy ước OTel GenAI; chi phí theo F-item. Control plane từ chối event thiếu trường.",
      ["Nền tảng", "Học"], "S", "P1",
      ["https://opentelemetry.io/blog/2026/genai-observability/"]),
    I("I25", "E", "Context rot; bàn giao giữa các phiên",
      "Chroma (18 model): mọi model kém đi khi input dài ra. Anthropic: agent chạy dài làm dở dang rồi phiên sau tuyên "
      "bố xong.",
      "C", "C",
      "Tóm tắt checkpoint do agent tự viết, bỏ sót các cách đã thử và hỏng; phiên sau lặp lại.",
      "Unit ≤ 1 phiên, checkpoint, progress log.",
      "Mỗi checkpoint kèm nhật ký lần thử do control plane ghi (fingerprint, cách đã thử) mà agent không sửa được.",
      ["Điều phối"], "S", "P1",
      ["https://www.trychroma.com/research/context-rot",
       "https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents"]),
    I("I26", "E", "Nhiều agent quyết định ngầm không khớp nhau",
      "MAST: 36,9% lỗi do lệch giữa các agent. Cognition: sub-agent làm nền kiểu Mario và con chim sai kiểu.",
      "P", "P",
      "Unit A lưu giờ địa phương, unit B lưu UTC trong cùng một field chuỗi. Cả hai đúng contract kiểu dữ liệu; không "
      "test nào nối hai bên.",
      "Contract đi trước.",
      "Contract mang ràng buộc ngữ nghĩa (đơn vị, múi giờ, encoding, null, thứ tự). Builder phải phát decision record "
      "(khóa, giá trị) cho mọi lựa chọn spec/contract không nói tới; control plane so khóa giữa các unit, xung đột → "
      "Architect.",
      ["Kế hoạch", "Build"], "M", "P1",
      ["https://cognition.com/blog/dont-build-multi-agents", "https://arxiv.org/html/2503.13657v2"]),
    I("I27", "E", "Vòng lặp và chi phí bùng nổ",
      "MAST: lặp bước là lỗi phổ biến nhất (15,7-17,1%). Cursor: agent đọc lại cùng đoạn file hàng trăm lần, hóa đơn tăng "
      "vọt trong vài phút.",
      "C", "P",
      "Vòng lặp GIỮA các unit: Fixer của F3 làm gãy F5, Fixer của F5 làm gãy F3, lặp qua nhiều chu kỳ QAS. Loop breaker "
      "theo phiên không thấy.",
      "Cây ngân sách, loop breaker theo phiên.",
      "Tối đa 3 thế hệ Fixer cho mỗi F-item. Phát hiện dao động ở mức run: cùng một test đổi xanh/đỏ > 2 lần qua các lần "
      "merge → đóng băng run, escalate kèm cặp unit.",
      ["Điều phối", "QAS"], "S", "P0",
      ["https://forum.cursor.com/t/agent-enters-infinite-loop-re-reading-the-exact-same-file-range-with-auto-mode/170975"]),
    I("I28", "E", "Đâm đầu vào hướng không khả thi",
      "Answer.AI giao Devin 20 việc: 3 thành công, 14 thất bại; hơn một ngày cố deploy thứ nền tảng không hỗ trợ.",
      "P", "P",
      "Unit không thể làm (thiếu API, mâu thuẫn); builder đốt hết lượt sửa rồi mới escalate.",
      "Trần lượt sửa, luật fingerprint.",
      "Timebox theo giờ thật = 2 lần ước lượng của unit. Tool BLOCKED với mã lý do (MISSING_INFO, IMPOSSIBLE, ENV) kết "
      "thúc phiên mà không tính là thất bại, chuyển về planner hoặc escalate; BLOCKED trùng lý do gộp thành một escalate.",
      ["Build", "Điều phối"], "S", "P0",
      ["https://www.answer.ai/posts/2025-01-08-devin"]),
    I("N1", "E", "Control plane sập hoặc lệch trạng thái",
      "Phát hiện trong phản biện. GitLab 2017 cho thấy cơ chế an toàn không được thử thì không tồn tại.",
      "-", "G",
      "Control plane sập giữa 'merge xong' và 'trạng thái = merged'. Git, lease và event log không khớp nhau: unit chạy "
      "lại hoặc mất; watchdog nằm cùng miền lỗi.",
      "Thiết kế dựa trên event, có receipt.",
      "Chuyển trạng thái idempotent có khóa. Reconciler mỗi 5 phút so git ref, lease, hàng merge, trạng thái QAS với "
      "trạng thái chiếu; lệch → đóng băng run đó và cảnh báo. Watchdog chạy tiến trình / máy riêng. Snapshot + replay được "
      "test trong CI.",
      ["Điều phối", "Nền tảng"], "M", "P0", []),
    I("I38", "E", "Control plane phức tạp, không ai sở hữu",
      "Google SRE: toil trung bình 33%, trần 50%. GitLab: > 78% thời gian dành cho bảo trì toolchain tự ghép.",
      "G", "G",
      "Một lỗi scheduler hoặc lease làm đứng mọi project cùng lúc. Lease, fencing, fair queuing, bulkhead, watchdog là một "
      "hệ phân tán không chủ, không test.",
      "Control plane là code, không phải LLM.",
      "Coi control plane là sản phẩm: có chủ, SLO, runbook. Chaos test trong CI: giết builder giữa lúc push, lease hết "
      "hạn giữa lúc ghi, bão 429, QAS sập, event trùng; phải qua trước bất kỳ run tự động nào.",
      ["Nền tảng"], "M", "P0",
      ["https://sre.google/sre-book/eliminating-toil/",
       "https://about.gitlab.com/the-source/platform/devops-teams-want-to-shake-off-diy-toolchains-a-platform-is-the-answer/"]),

    # F. Learning and evaluation
    I("I22", "F", "Đầu độc lesson / bộ nhớ",
      "AgentPoison: tỉ lệ đầu độc < 0,1% cho ~63% tấn công thành công end-to-end. MINJA: đầu độc chỉ qua truy vấn "
      "thường.",
      "P", "P",
      "Lesson được chắt từ một run mà 'bản sửa' là đặc cách test ('khi X fail thì mock Y'). Bộ golden không phủ trường hợp "
      "đó nên qua eval, rồi lan sang mọi project. Chữ bị tiêm trong spec cũng có thể thành lesson.",
      "Cổng eval, phục vụ theo version.",
      "Mọi lesson có nguồn gốc (run, event). Chỉ chắt từ unit đã qua QAS + review và không có cờ gian lận. Mở rộng theo "
      "nấc: trong project trước, liên project chỉ khi có ≥ 3 project độc lập ủng hộ. Quét lesson tìm câu mệnh lệnh / nội "
      "dung bảo mật / tên guard. Lesson có TTL; tự rollback khi canary tăng lỗi.",
      ["Học"], "M", "P1",
      ["https://arxiv.org/html/2407.12784v1", "https://arxiv.org/abs/2503.03704"]),
    I("I32", "F", "Eval của chính mình bị thổi phồng / rò rỉ",
      "SWE-Bench+: 32,67% bản vá 'thành công' dùng lời giải lộ trong issue; 31,08% qua nhờ test yếu.",
      "G", "G",
      "Golden task lấy từ project cũ, cũng là nguồn của lesson: lesson được chấm trên chính bài đã sinh ra nó. Agent còn "
      "thấy nội dung golden qua RAG System.",
      "Chưa có.",
      "Loại theo nguồn gốc: lesson không được chấm trên task nó được chắt ra. Holdout riêng, làm mới hằng quý từ project "
      "mới, nằm ngoài RAG System, có chuỗi canary để phát hiện rò rỉ.",
      ["Học"], "M", "P1",
      ["https://arxiv.org/html/2410.06992v2", "https://arxiv.org/html/2506.12286v4"]),
    I("I31", "F", "Model / hạ tầng serving trôi",
      "Anthropic 8-9/2025: 3 lỗi hạ tầng, một lỗi định tuyến sai tới 16% request Sonnet 4; eval nội bộ không bắt được. "
      "GPT-4: code chạy được từ 52% xuống 10% trong 3 tháng.",
      "P", "P",
      "Provider đổi serving sau một alias đã pin; chất lượng tụt 10% không ai thấy cho tới khi tỉ lệ QAS đỏ tăng.",
      "Run pin version, SLO tự rollback.",
      "Pin id snapshot, không pin alias. Eval canary hằng đêm cho mỗi cặp model-vai trò; tụt > 5% so với nền → đóng băng "
      "phiên mới trên model đó, chuyển sang model thay thế.",
      ["Học", "Nền tảng"], "S", "P1",
      ["https://www.anthropic.com/engineering/a-postmortem-of-three-recent-issues", "https://arxiv.org/abs/2307.09009"]),
    I("N5", "F", "Vòng học tối ưu chính thước đo của nó (Goodhart)",
      "Phát hiện trong phản biện. METR: reward hacking xuất hiện ngay khi thước đo nằm trong tầm với.",
      "-", "G",
      "Distiller giảm số mã lỗi. Lesson kiểu 'giữ diff nhỏ để tránh tín hiệu plan-vs-diff' làm giảm số đếm bằng cách giấu "
      "tín hiệu, không giảm lỗi; nâng thành luật cứng thì tắt luôn khả năng phát hiện ở mọi nơi.",
      "Cổng eval.",
      "Chấm lesson bằng kết quả (QAS xanh lần đầu, lỗi lọt UAT, holdout pass), không bằng số mã lỗi. Lesson không được "
      "nhắc tên / ngưỡng của guard hay verifier (lint). Lesson thành luật cứng phải qua model phán xét (khác Distiller) + "
      "canary; không được nới lỏng guard an toàn.",
      ["Học"], "S", "P1",
      ["https://metr.org/blog/2025-06-05-recent-reward-hacking/"]),

    # G. People and measurement
    I("I07", "G", "Quá tải escalate; người duyệt cho có",
      "Người dùng Claude Code duyệt 93% yêu cầu quyền. curl dừng bug bounty 1/2026 vì báo cáo rác do AI. SOC: > 1/3 "
      "analyst bỏ qua cảnh báo khi hàng đầy.",
      "P", "P",
      "20 run mỗi run escalate 5 việc/ngày, thường cùng một gốc. Người duyệt trong < 10 giây. Gói escalate là văn xuôi "
      "dài, không có một quyết định cụ thể.",
      "Chỉ thông báo khi đỏ / escalate / xanh.",
      "Schema gói escalate, code kiểm: một quyết định, 2-4 phương án, phương án đề xuất, link bằng chứng, tác động mỗi "
      "phương án, hạn chót; thiếu trường → trả agent. Gộp theo fingerprint giữa các run. Ngân sách: 3 escalate mở mỗi "
      "project, vượt → tạm dừng F-item ưu tiên thấp. Đo % duyệt < 15 giây; cài 1/20 escalate sai có chủ đích để đo tỉ lệ "
      "người bắt được.",
      ["Board/Escalate"], "S-M", "P0",
      ["https://www.anthropic.com/engineering/claude-code-auto-mode",
       "https://www.theregister.com/2026/01/21/curl_ends_bug_bounty/"]),
    I("I33", "G", "Kỹ năng con người mai một, giám sát yếu đi",
      "RCT của Anthropic (52 kỹ sư): nhóm dùng AI điểm hiểu bài thấp hơn 17%, chênh lớn nhất ở debug.",
      "G", "G",
      "Người chỉ thấy escalate, mất mô hình trong đầu về codebase, duyệt sai phương án.",
      "Chưa có.",
      "Tỉ lệ bắt lỗi cài sẵn theo từng người duyệt (chung với I07). Review sâu ngẫu nhiên 5% unit đã merge mỗi run, có "
      "chấm điểm phát hiện. Luân phiên người.",
      ["Board/Escalate"], "M", "P2",
      ["https://www.anthropic.com/research/AI-assistance-coding-skills"]),
    I("I34", "G", "Ảo giác năng suất",
      "METR RCT: dev giàu kinh nghiệm chậm hơn 19% với AI nhưng tin mình nhanh hơn 20%. DORA: AI gắn với độ ổn định "
      "giao hàng giảm 7,2%.",
      "G", "G",
      "Board trông nhanh, nhưng UAT và production tìm ra lỗi và việc làm lại không ai quy ngược về dây chuyền.",
      "Token và ETA trên board.",
      "Chỉ số kết quả theo F-item: thời gian từ đóng băng tới xanh, lỗi lọt (UAT, production) mỗi F-item, % làm lại, phút "
      "công người mỗi F-item, chi phí. So với nền lịch sử hoặc nhóm người đối chứng trước khi mở rộng.",
      ["Học", "Board/Escalate"], "S", "P1",
      ["https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/"]),
    I("I36", "G", "Ốc đảo tri thức",
      "Stack Overflow: > 2/3 dev đụng ốc đảo tri thức ít nhất mỗi tuần. Atlassian: 41% thiếu tài liệu.",
      "C", "C",
      "RAG System đầy chữ do agent viết, ít giá trị; người thôi đọc.",
      "RAG System.",
      "Chưa cần. Tùy chọn: mục lục tóm tắt cho người theo F-item.",
      ["Học"], "S", "P2",
      ["https://www.ciodive.com/news/knowledge-silos-software-retention-developers/630046/"]),
]

TOP10 = [
    ("I15", "Fencing epoch trên mọi thao tác ghi", "S", "Xóa hẳn hỏng dữ liệu âm thầm do người giữ lease cũ."),
    ("I23 + I24", "Gói toàn vẹn test: khóa đường hạ tầng test, kiểm số test và skip, bộ holdout", "S-M",
     "Chặn nhóm gian lận phổ biến nhất (30-76% trong nghiên cứu)."),
    ("I10 + I14", "SAST, SCA và kiểm dependency tồn tại ở verifier", "S", "45% code AI có lỗ hổng; 19,7% mẫu có package bịa."),
    ("I29", "Cổng sẵn sàng môi trường trước run", "S", "Ngăn cả run bị tính nhầm là lỗi agent (38% → 69% ở dotnet)."),
    ("I17 + I28", "Phân loại lỗi INFRA và lối thoát BLOCKED", "S", "Bỏ phần lớn escalate giả và đâm đầu vào ngõ cụt."),
    ("I04", "Test cách ly không tính xanh; burn-in 10/10 cho test mới", "S", "Không để race thật lọt qua nhờ quarantine."),
    ("I12 + I13", "Gỡ chữ ẩn, bỏ qua cấu hình agent trong repo, người xác nhận yêu cầu nhạy cảm", "S-M",
     "Đóng đường tiêm lệnh qua chính tài liệu đầu vào."),
    ("I08", "Skeleton lên QAS ở merge đầu; smoke mỗi 5 merge", "S", "Bỏ kiểu deploy big bang cuối run."),
    ("N2 + N3", "Cổng testability ở intake; câu trả lời người thành phụ lục có version", "S",
     "Spec có trọng tài; không hỏi lại cùng một câu."),
    ("I01", "Checklist khe trống + Sổ giả định", "M", "Phòng tuyến chính chống mặc định chung âm thầm."),
]

WEAK3 = [
    ("Hai reader + đối chiếu",
     "Chỉ phát hiện bất đồng. Cùng thiên kiến nên mù với chỗ spec im lặng (I01); luật trích dẫn hợp thức hóa chữ bị tiêm "
     "(I12); và output của nó là điểm chung duy nhất mà cả test lẫn code phụ thuộc (N4)."),
    ("Chạy QAS 3 lần + cách ly test flaky",
     "Biến race thật thành F-item xanh, không trần, không chủ, và cho builder một lối thoát khỏi test đang fail "
     "(I04, I23)."),
    ("'Xung đột ngữ nghĩa → unit sau sửa' ở hàng merge",
     "Bản sửa không có chủ, trái scope guard, không có test chéo unit, và là nguồn gây ping-pong giữa các Fixer "
     "(I03, I27)."),
]
