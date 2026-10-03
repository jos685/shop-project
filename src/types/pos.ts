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
    };
  }
  
  export interface ListedCartItem {
    kind: "listed";
    key: string;             // = allocation.id
    allocation: LocalAlloc;
    quantity: number;
    sellPrice: number;
  }
  
  export interface UnlistedCartItem {
    kind: "unlisted";
    key: string;             // = crypto.randomUUID()
    customItemId: string | null;
    name: string;
    unit: string;
    quantity: number;
    sellPrice: number;
  }
  
  export type CartItem = ListedCartItem | UnlistedCartItem;
  
  // ── Helpers ──
  export const cartItemName = (i: CartItem) =>
    i.kind === "listed" ? i.allocation.product.name : i.name;
  
  export const cartItemUnit = (i: CartItem) =>
    i.kind === "listed" ? i.allocation.product.unit : i.unit;
  
  export const cartItemImage = (i: CartItem) =>
    i.kind === "listed" ? i.allocation.product.image_url : null;
  
  export const cartItemBasePrice = (i: CartItem) =>
    i.kind === "listed" ? i.allocation.product.price : i.sellPrice;