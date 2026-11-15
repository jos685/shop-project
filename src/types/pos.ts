// ── Custom item (mirrors shop_custom_items) ──
export interface CustomItem {
  id: string;
  shop_id: string;
  name: string;
  unit: string;
  default_price: number;
  category: string | null;
  active: boolean;
}

// ── Cart ──
export interface LocalAlloc {
  id: string;
  allocated: number;
  remaining: number;
  product_id: string;
  product: {
    id: string;
    name: string;
    sku: string;
    price: number;
    unit: string;
    image_url: string | null;
    batch_label?: string | null;
    expiry_date?: string | null;
    attributes?:
      | { Size?: string; Color?: string; [k: string]: string | undefined }
      | null;
  };
}

export interface ListedCartItem {
  kind: "listed";
  key: string;             // = allocation.id
  allocation: LocalAlloc;
  quantity: number;
  sellPrice: number;
  discount: number;
}

export interface UnlistedCartItem {
  kind: "unlisted";
  key: string;             // = crypto.randomUUID()
  customItemId: string | null;
  name: string;
  unit: string;
  quantity: number;
  sellPrice: number;
  buyingPrice?: number | null;
  discount: number;
}

export type CartItem = ListedCartItem | UnlistedCartItem;

// ── Helpers ──

/**
 * Human-readable name for a cart line.
 * For listed items, appends variant attributes so two variants of the
 * same product don't render as identical rows:
 *   "Timber" with { Size: "32", Color: "red" }  →  "Timber · 32 · red"
 * Extra attribute keys (Length, Grade, …) are appended as "Key: Value".
 */
export const cartItemName = (i: CartItem): string => {
  if (i.kind === "unlisted") return i.name;

  const p = i.allocation.product;
  const a = p.attributes;

  if (a && typeof a === "object") {
    const bits: string[] = [];

    // Common ones first so the name reads naturally
    if (a.Size)  bits.push(a.Size);
    if (a.Color) bits.push(a.Color);

    // Then everything else (skip the two we already pushed)
    for (const [k, v] of Object.entries(a)) {
      if (k === "Size" || k === "Color") continue;
      if (v) bits.push(`${k}: ${v}`);
    }

    if (bits.length) return `${p.name} · ${bits.join(" · ")}`;
  }

  return p.name;
};

export const cartItemUnit = (i: CartItem) =>
  i.kind === "listed" ? i.allocation.product.unit : i.unit;

export const cartItemImage = (i: CartItem) =>
  i.kind === "listed" ? i.allocation.product.image_url : null;

export const cartItemBasePrice = (i: CartItem) =>
  i.kind === "listed" ? i.allocation.product.price : i.sellPrice;