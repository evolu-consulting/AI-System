/** What the assistant is looking at: sent with every question so answers and cards fit the page. */
export type PageContext = { page: string; id?: string; placeholder: string };

const BY_PAGE: [RegExp, Omit<PageContext, "id">][] = [
  [/^\/contracts\/(?!new)[^/]+/, { page: "contract", placeholder: "Hỏi, hoặc nhờ sửa thông tin hợp đồng này…" }],
  [/^\/contracts/, { page: "contracts", placeholder: "Hỏi, hoặc kéo thả file hợp đồng…" }],
  [/^\/partners/, { page: "partners", placeholder: "Hỏi về đối tác…" }],
  [/^\/prices/, { page: "prices", placeholder: "Hỏi về giá, nhà cung cấp…" }],
  [/^\/cks\/[^/]+/, { page: "cks_customer", placeholder: "Hỏi về chữ ký của khách này…" }],
  [/^\/cks/, { page: "cks", placeholder: "Hỏi về chữ ký số, nhóm, lô…" }],
  [/^\/settings\/scoring/, { page: "scoring", placeholder: "Hỏi về cách tính điểm…" }],
];

export function pageContext(pathname: string, search = ""): PageContext {
  // So sánh giá opens on the signatures (no ?product=, or ?product=cks); a product key shows goods
  if (pathname.startsWith("/prices") && (new URLSearchParams(search).get("product") ?? "cks") === "cks") {
    return { page: "prices_cks", placeholder: "Hỏi về giá mua, giá bán, lãi…" };
  }
  for (const [re, c] of BY_PAGE) {
    if (re.test(pathname)) {
      const id = pathname.split("/")[2];
      return { ...c, ...(id && (c.page.endsWith("customer") || c.page === "contract") ? { id: decodeURIComponent(id) } : {}) };
    }
  }
  return { page: "other", placeholder: "Hỏi trợ lý…" };
}
