// Pure business-logic helpers extracted from page components so they can be unit tested.

export type PayMethod = "cash" | "mpesa" | "split" | "credit";

export interface CartItem {
  sellPrice: number;
  quantity: number;
  allocation: {
    product_id: string;
    product: { name: string; price: number };
    remaining: number;
    id: string;
  };
}

/** Format a KSh amount. */
export function fmt(n: number): string {
  return `KSh ${n.toLocaleString()}`;
}

/** Grand total from cart. */
export function calcGrandTotal(cart: CartItem[]): number {
  return cart.reduce((s, i) => s + i.sellPrice * i.quantity, 0);
}

/** Validate checkout fields before proceeding to verify step. */
export function validateCheckout(
  cart: CartItem[],
  payMethod: PayMethod,
  customerName: string,
  customerPhone: string,
  cashAmount: string,
  mpesaAmount: string,
  grandTotal: number,
): string | null {
  if (cart.length === 0) return "Add at least one product to the cart.";

  if (payMethod === "credit") {
    if (!customerName.trim()) return "Customer name is required for credit sales.";
    if (!customerPhone.trim()) return "Customer phone is required for credit sales.";
  }

  if (payMethod === "split") {
    const c = Number(cashAmount) || 0;
    const m = Number(mpesaAmount) || 0;
    if (!cashAmount || !mpesaAmount) return "Enter both Cash and M-Pesa amounts.";
    if (Math.abs(c + m - grandTotal) > 1)
      return `Cash + M-Pesa must equal ${fmt(grandTotal)}.`;
  }

  return null;
}

/** Validate a cart item add/update. */
export function validateCartAdd(
  qty: number,
  sellPrice: number,
  basePrice: number,
  remaining: number,
  canEditPrice: boolean,
): string | null {
  if (qty > remaining) return `Only ${remaining} units available.`;
  if (canEditPrice && sellPrice < basePrice)
    return `Sell price cannot be less than ${fmt(basePrice)}.`;
  return null;
}

/** Compute credit sale status from payment amounts. */
export function creditStatus(initPaid: number, grandTotal: number): "paid" | "partial" | "pending" {
  if (initPaid >= grandTotal - 0.5) return "paid";
  if (initPaid > 0) return "partial";
  return "pending";
}

/** Normalise a Kenyan phone number to +254XXXXXXXXX. */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("254") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+254${digits.slice(1)}`;
  if (digits.length === 9) return `+254${digits}`;
  return null;
}

/** Hour label for the sales chart. */
export function hourLabel(h: number): string {
  if (h === 12) return "12PM";
  if (h < 12) return `${h}AM`;
  return `${h - 12}PM`;
}

/** Compute commission earned on a single item. */
export function calcCommission(
  sellPrice: number,
  basePrice: number,
  quantity: number,
  commRate: number,
): number {
  const markup = Math.max(0, sellPrice - basePrice);
  return Math.round(markup * quantity * commRate / 100);
}
