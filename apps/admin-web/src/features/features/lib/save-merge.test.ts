// ADM-FR-55 · CR-121 R4 · lưu lần 1 → sửa nháp → lưu lần 2 khi refetch/phản hồi lần 1 về muộn: nháp không bị đè, không hàng trùng.
import { expect, test } from "bun:test";
import type { FeatureDetail } from "@ai/contracts/features";
import { commandsAfterSave, isStaleSave, newerDetail, sameIdSet, uniqueIds } from "./save-merge";

const K = "kiemtra-hoadon";
const T = "tom-tat";
const detail = (version: number) => ({ version }) as FeatureDetail;

test("phản hồi lưu lần 1 về muộn sau khi người dùng bỏ /kiemtra-hoadon: giữ nháp [tom-tat], vẫn dirty", () => {
  // server sau lần lưu 1 = [kiemtra, tom-tat]; người dùng đã bỏ kiemtra trong lúc chờ
  const r = commandsAfterSave([K, T], [T], true);
  expect(r).toEqual({ ids: [T], dirty: true });
});

test("không sửa gì trong lúc chờ ⇒ lấy đúng bản server, không dirty", () => {
  expect(commandsAfterSave([K, T], [K], false)).toEqual({ ids: [K, T], dirty: false });
});

test("nháp trùng bản server (sửa rồi hoàn tác) ⇒ không dirty", () => {
  expect(commandsAfterSave([T, K], [K, T], true).dirty).toBe(false);
});

test("không bao giờ có id lặp (nhân đôi hàng /tom-tat)", () => {
  expect(uniqueIds([T, K, T])).toEqual([T, K]);
  expect(commandsAfterSave([T, T], [T, K, T], true).ids).toEqual([T, K]);
});

test("refetch cũ (v2) về sau khi đã có v3 trong cache ⇒ giữ v3", () => {
  const cached = detail(3);
  expect(newerDetail(cached, detail(2))).toBe(cached);
  const fresh = detail(4);
  expect(newerDetail(cached, fresh)).toBe(fresh);
  expect(newerDetail(undefined, fresh)).toBe(fresh);
});

test("phản hồi lưu có version cũ hơn bản đã áp ⇒ bỏ qua", () => {
  expect(isStaleSave(3, 2)).toBe(true);
  expect(isStaleSave(3, 3)).toBe(false);
  expect(isStaleSave(3, 4)).toBe(false);
});

test("sameIdSet không phụ thuộc thứ tự", () => {
  expect(sameIdSet([K, T], [T, K])).toBe(true);
  expect(sameIdSet([K], [T])).toBe(false);
});
