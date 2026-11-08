// CR-125 G6 · một nhãn cho cùng một trạng thái: "Đang hiệu lực" (gape.status.active), "Đang chờ ký" (esign.pending); thẻ quy trình có liên kết sang mục Quy trình duyệt.
import { expect, test } from "bun:test";
import docframe from "../../../../../../../packages/i18n/locales/contracts/docframe.vi.json";
import esign from "../../../../../../../packages/i18n/locales/contracts/esign.vi.json";
import esignflow from "../../../../../../../packages/i18n/locales/contracts/esignflow.vi.json";
import gape from "../../../../../../../packages/i18n/locales/contracts/gape.vi.json";
import rep3 from "../../../../../../../packages/i18n/locales/contracts/rep3.vi.json";

test("trạng thái trùng chữ chỉ còn một khoá", () => {
  expect(gape.contracts.gape.status.active).toBe("Đang hiệu lực");
  expect("active" in docframe.contracts.docframe.stage).toBe(false);
  expect(esign.contracts.esign.pending).toBe("Đang chờ ký");
  expect("waiting" in esignflow.contracts.approval.module.outcome).toBe(false);
});

test("thẻ quy trình ở mục Ứng dụng: một dòng + liên kết sang Quy trình duyệt, không còn nút sơ đồ", () => {
  const apps = rep3.contracts.settings.apps as Record<string, string>;
  expect(apps.openFlow).toBeTruthy();
  expect(apps.viewDiagram).toBeUndefined();
  expect(apps.current).toBe("Đang áp dụng: {{name}}");
});
