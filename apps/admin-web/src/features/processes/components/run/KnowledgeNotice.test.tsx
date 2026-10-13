// HUB-FR-134 · K1 F4 · FE-U1: render `warning` / n-of-5 / Tóm tắt / write_to; `knowledge` vắng ⇒ không render.
import { beforeAll, expect, test } from "bun:test";
import type { StageView } from "@ai/contracts/chat";
import { loadProcessLocale } from "@ai/i18n/process-locales";
import { createInstance, type i18n as I18n } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { KnowledgeNotice } from "./KnowledgeNotice";

let i18n: I18n;
beforeAll(async () => {
  i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "vi",
    resources: { vi: { translation: await loadProcessLocale("vi") } },
    interpolation: { escapeValue: false },
  });
});

type K = NonNullable<StageView["knowledge"]>;
const k = (o: Partial<K> = {}): K => ({
  write_to: null,
  queries: 2,
  query_limit: 5,
  warning: null,
  summary: "pending",
  ...o,
});
const html = (knowledge: StageView["knowledge"]) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <KnowledgeNotice knowledge={knowledge} />
    </I18nextProvider>,
  );

test("n/5 lần hỏi + Tóm tắt, không warning ⇒ không có status", () => {
  const h = html(k());
  expect(h).toContain("Tri thức: 2/5 lần hỏi");
  expect(h).toContain("Tóm tắt: đang chờ");
  expect(h).not.toContain('role="status"');
});

test("warning ⇒ status hạ cấp kèm lý do", () => {
  const h = html(k({ warning: "timeout" }));
  expect(h).toContain('role="status"');
  expect(h).toContain("Không truy cập được KnowledgeHub");
  expect(h).toContain("Hết thời gian chờ");
});

test("write_to ⇒ (ghi vào project · connection)", () => {
  expect(
    html(k({ summary: "written", write_to: { project: "p1", connection: "kh-a" } })),
  ).toContain("(ghi vào p1 · kh-a)");
});

test("knowledge vắng ⇒ không render", () => {
  expect(html(undefined)).toBe("");
});
