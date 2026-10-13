// đặt hit mock KH cho project evolu: text chứa các mục `## ...` của stage (fake-cli trả nguyên kết quả tool làm output)
const HEAD = "Tri thức tham chiếu của KH (mock):\n\n";
export async function setHits(sections) {
  const body = [...sections].sort((a, b) => (b === "Tóm tắt") - (a === "Tóm tắt"))
    .map((s) => `## ${s}\n${s === "Tóm tắt" ? "Tóm tắt của stage: đã dùng tri thức KH (mock) để hoàn thành." : `Nội dung (KH mock).`}`)
    .join("\n\n");
  const r = await fetch("http://localhost:4030/__mock/kh/projects/evolu", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hits: [{ score: 0.9, source_text: HEAD + body }] }),
  });
  if (r.status !== 204) throw new Error("setHits " + r.status);
}
export const kh = async () => (await fetch("http://localhost:4030/__mock/kh/calls")).json();
