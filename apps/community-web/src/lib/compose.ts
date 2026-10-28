// Form soạn bài → CreatePostInput (logic thuần): trường bắt buộc theo loại (nghiep-vu §4) và giới hạn ảnh/video.
import {
  type CreatePostInput,
  MEDIA_LIMITS,
  type MediaItem,
  type PostAudience,
  type PostType,
} from "@ai/contracts/community";

export type Draft = {
  type: PostType;
  body: string;
  product: string;
  qty: string;
  price: string;
  area: string;
  neededBy: string;
  budget: string;
  cats: string[];
  media: MediaItem[];
  audience?: PostAudience;
};

export const emptyDraft = (type: PostType = "sell"): Draft => ({
  type,
  body: "",
  product: "",
  qty: "",
  price: "",
  area: "",
  neededBy: "",
  budget: "",
  cats: [],
  media: [],
});

/** Lỗi theo trường; rỗng = hợp lệ. */
export function draftErrors(d: Draft): Record<string, string> {
  const e: Record<string, string> = {};
  const need = (k: string, v: string, msg: string) => {
    if (!v.trim()) e[k] = msg;
  };
  if (d.type === "note") need("body", d.body, "Nhập nội dung thông báo");
  else {
    need("product", d.product, "Nhập hàng hoá");
    need("qty", d.qty, "Nhập số lượng");
  }
  if (d.type === "buy") {
    need("area", d.area, "Nhập khu vực");
    need("neededBy", d.neededBy, "Chọn ngày cần");
  }
  return e;
}

export const canAddMedia = (media: MediaItem[], kind: MediaItem["kind"]): boolean =>
  media.filter((m) => m.kind === kind).length < MEDIA_LIMITS[kind];

/** `price` bỏ trống ở Cần bán = "liên hệ" (null). Đối tác không gửi audience. */
export function toCreateInput(d: Draft, isHostViewer: boolean): CreatePostInput {
  const common = {
    title: d.product.trim(),
    body: d.body.trim(),
    cats: d.cats,
    media: d.media,
    ...(isHostViewer && d.audience ? { audience: d.audience } : {}),
  };
  if (d.type === "sell") {
    const price = d.price.trim();
    return {
      ...common,
      type: "sell",
      fields: {
        product: d.product.trim(),
        qty: d.qty.trim(),
        price: price === "" ? null : price,
        area: d.area.trim(),
      },
    };
  }
  if (d.type === "buy") {
    return {
      ...common,
      type: "buy",
      fields: {
        product: d.product.trim(),
        qty: d.qty.trim(),
        area: d.area.trim(),
        neededBy: d.neededBy,
        budget: d.budget.trim(),
      },
    };
  }
  return { ...common, type: "note", title: "", fields: {} };
}

/** Bài đang sửa → Draft (để dùng lại cùng form). */
export function draftFromFields(
  type: PostType,
  body: string,
  fields: Record<string, string | null>,
  cats: string[],
): Draft {
  return {
    ...emptyDraft(type),
    body,
    cats,
    product: fields.product ?? "",
    qty: fields.qty ?? "",
    price: fields.price ?? "",
    area: fields.area ?? "",
    neededBy: fields.neededBy ?? "",
    budget: fields.budget ?? "",
  };
}
