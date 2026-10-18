# ADR-0021 · Một dịch vụ tri thức thay hai RAG

Trạng thái: **Accepted** (2026-10-18, người dùng chốt, CR-094) · Ngày: 2026-10-17 · Thay thế dần: ADR-0012 (KnowledgeHub) cho dữ liệu khách

## Bối cảnh
- mgmt-app có RAG đầy đủ: connector, parse, chunk theo tiêu đề, embedding OpenAI 1536 chiều, OpenSearch hybrid BM25 + vector, Neo4j, LLM rerank, trả lời có trích dẫn. Kho tài liệu chung **không lọc org**.
- AI-System gọi KnowledgeHub bên ngoài (`kh-query`), không parse PDF/DOCX, embedding mặc định yếu tiếng Việt, **không tách tenant phía Hub** (CR-073).

## Quyết định
1. Một dịch vụ tri thức của mình, dựng từ pipeline mgmt-app; lúc đầu là module trong backend gói, tách service khi tải lớn.
2. Mở bằng tool MCP `knowledge.search`, `knowledge.get`, `knowledge.add`. Truy vấn thiếu tenant bị từ chối; lọc theo quyền tài liệu.
3. File gốc ở FileBox, metadata và quyền ở Postgres; chunk, embedding, graph là bản dẫn xuất.
4. Graph Neo4j, trích thực thể, rerank riêng chỉ giữ khi eval tiếng Việt chứng minh có lợi.
5. KnowledgeHub dừng dùng cho dữ liệu khách; chỉ còn nội bộ hoặc tắt.

## Hệ quả
- Tiêu chí chấp nhận: test chéo tenant không lộ đoạn nào; eval dịch vụ mới bằng hoặc hơn cả hai RAG cũ; không stage nào gọi `kh-query` với dữ liệu khách.
- Lịch: kéo lên GĐ1, lát N4 ([intake-hd](../platform/intake-hd.md)): bước đầu eval 0.11 (bộ câu hỏi tiếng Việt, đo cả hai RAG), rồi dựng dịch vụ (CR-094).
