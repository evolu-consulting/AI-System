// CR-180 · nền mobile: cỡ chạm ≥ 44px (class max-sm), PageHeader / FilterBar / MetaList (render tĩnh, không DOM).
import { describe, expect, test } from "bun:test";
import { Button } from "@ai/web-kit/ui/kit/button";
import { FilterBar } from "@ai/web-kit/ui/kit/filter-bar";
import { Input } from "@ai/web-kit/ui/kit/input";
import { MetaList } from "@ai/web-kit/ui/kit/meta-list";
import { PageHeader } from "@ai/web-kit/ui/kit/page-header";
import { Select, SelectTrigger, SelectValue } from "@ai/web-kit/ui/kit/select";
import { Tabs, TabsList, TabsTrigger } from "@ai/web-kit/ui/kit/tabs";
import { ToggleGroup, ToggleGroupItem } from "@ai/web-kit/ui/kit/toggle-group";
import { renderToStaticMarkup } from "react-dom/server";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("cỡ chạm ≥ 44px trên điện thoại", () => {
  test("Button mọi cỡ có min-h-11", () => {
    expect(html(<Button>x</Button>)).toContain("max-sm:min-h-11");
    expect(html(<Button size="sm">x</Button>)).toContain("max-sm:min-h-11");
    const icon = html(
      <Button size="icon" aria-label="Đóng">
        x
      </Button>,
    );
    expect(icon).toContain("max-sm:min-h-11");
    expect(icon).toContain("max-sm:min-w-11");
  });
  test("Input, ToggleGroup item, Tabs trigger, Select trigger có min-h-11", () => {
    expect(html(<Input />)).toContain("max-sm:min-h-11");
    expect(
      html(
        <ToggleGroup type="single">
          <ToggleGroupItem value="a">a</ToggleGroupItem>
        </ToggleGroup>,
      ),
    ).toContain("max-sm:min-h-11");
    expect(
      html(
        <Tabs defaultValue="a">
          <TabsList>
            <TabsTrigger value="a">a</TabsTrigger>
          </TabsList>
        </Tabs>,
      ),
    ).toContain("max-sm:min-h-11");
    expect(
      html(
        <Select>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
        </Select>,
      ),
    ).toContain("max-sm:min-h-11");
  });
});

describe("PageHeader", () => {
  test("tiêu đề + mô tả + nút chính một lần, rộng hết trên điện thoại", () => {
    const out = html(
      <PageHeader title="Hợp đồng" description="Mô tả" primary={<Button>Tạo hợp đồng</Button>} />,
    );
    expect(out).toContain("Hợp đồng");
    expect(out).toContain("Mô tả");
    expect(out.match(/Tạo hợp đồng/g)).toHaveLength(1);
    expect(out).toContain("max-sm:order-last");
    expect(out).toContain("max-sm:w-full");
  });
  test("nút phụ: desktop hiện, điện thoại gom vào «⋯»", () => {
    const out = html(<PageHeader title="T" actions={[{ label: "Xuất", onSelect: () => {} }]} />);
    expect(out).toContain("max-sm:hidden");
    expect(out).toContain("Xuất");
    expect(out).toContain('aria-label="Thêm thao tác"');
  });
  test("không có actions ⇒ không có nút «⋯»", () => {
    expect(html(<PageHeader title="T" />)).not.toContain("Thêm thao tác");
  });
});

describe("FilterBar", () => {
  test("chip 1 hàng cuộn ngang + mờ mép; nâng cao ẩn trên điện thoại, nút «Lọc» hiện", () => {
    const out = html(
      <FilterBar chips={<span>Tất cả</span>} advanced={<span>Từ ngày</span>} activeCount={2} />,
    );
    expect(out).toContain("max-sm:overflow-x-auto");
    expect(out).toContain("max-sm:flex-nowrap");
    expect(out).toContain("mask-image");
    expect(out).toContain("max-sm:hidden");
    expect(out).toContain("Lọc");
    expect(out).toContain("(2)");
  });
  test("không có nâng cao ⇒ không có nút «Lọc»", () => {
    expect(html(<FilterBar chips={<span>a</span>} />)).not.toContain("Lọc");
  });
});

describe("MetaList", () => {
  test("dấu «·» chỉ giữa các mục (not-first), mỗi mục một dòng trên điện thoại", () => {
    const out = html(
      <MetaList
        items={[
          { label: "Đối tác", value: "A" },
          { label: "Hạn", value: "" },
          { label: "Phụ trách", value: "B" },
        ]}
      />,
    );
    expect(out).toContain("not-first:before:content-");
    expect(out).toContain("max-sm:grid-cols-[max-content_minmax(0,1fr)]"); // điện thoại: 2 cột nhãn | giá trị thẳng hàng
    expect(out).toContain("max-sm:contents");
    expect(out).toContain("Đối tác");
    expect(out).not.toContain("Hạn");
    expect(out).toContain("Phụ trách");
  });
  test("không còn mục nào ⇒ không render", () => {
    expect(html(<MetaList items={[{ label: "x", value: null }]} />)).toBe("");
  });
});
