import { describe, it, expect } from "vitest";
import {
  fmt,
  calcGrandTotal,
  validateCheckout,
  validateCartAdd,
  creditStatus,
  normalisePhone,
  hourLabel,
  calcCommission,
  type CartItem,
} from "./posLogic";

// ─── fmt ────────────────────────────────────────────────────────────────────
describe("fmt", () => {
  it("formats zero", () => {
    expect(fmt(0)).toBe("KSh 0");
  });
  it("formats a whole number", () => {
    expect(fmt(1500)).toBe("KSh 1,500");
  });
  it("formats large amounts", () => {
    expect(fmt(1_000_000)).toBe("KSh 1,000,000");
  });
});

// ─── calcGrandTotal ──────────────────────────────────────────────────────────
const makeItem = (sellPrice: number, quantity: number, productId = "p1"): CartItem => ({
  sellPrice,
  quantity,
  allocation: {
    product_id: productId,
    id: "a1",
    remaining: 100,
    product: { name: "Test Product", price: sellPrice },
  },
});

describe("calcGrandTotal", () => {
  it("returns 0 for empty cart", () => {
    expect(calcGrandTotal([])).toBe(0);
  });
  it("sums single item", () => {
    expect(calcGrandTotal([makeItem(500, 2)])).toBe(1000);
  });
  it("sums multiple items", () => {
    const cart = [makeItem(100, 3, "p1"), makeItem(200, 2, "p2")];
    expect(calcGrandTotal(cart)).toBe(700);
  });
  it("uses sellPrice, not base price", () => {
    const item: CartItem = {
      sellPrice: 600,
      quantity: 1,
      allocation: {
        product_id: "p1", id: "a1", remaining: 10,
        product: { name: "X", price: 400 }, // base price 400, sell 600
      },
    };
    expect(calcGrandTotal([item])).toBe(600);
  });
});

// ─── validateCheckout ────────────────────────────────────────────────────────
describe("validateCheckout", () => {
  const cart = [makeItem(500, 1)];

  it("rejects empty cart", () => {
    expect(validateCheckout([], "cash", "", "", "", "", 0)).toMatch(/product/i);
  });

  it("passes valid cash sale", () => {
    expect(validateCheckout(cart, "cash", "", "", "", "", 500)).toBeNull();
  });

  it("rejects credit sale with no customer name", () => {
    expect(validateCheckout(cart, "credit", "", "0712345678", "", "", 500)).toMatch(/name/i);
  });

  it("rejects credit sale with no phone", () => {
    expect(validateCheckout(cart, "credit", "Jane", "", "", "", 500)).toMatch(/phone/i);
  });

  it("passes valid credit sale", () => {
    expect(validateCheckout(cart, "credit", "Jane", "0712345678", "", "", 500)).toBeNull();
  });

  it("rejects split when amounts missing", () => {
    expect(validateCheckout(cart, "split", "", "", "", "", 500)).toMatch(/both/i);
  });

  it("rejects split when amounts don't add up", () => {
    expect(validateCheckout(cart, "split", "", "", "200", "200", 500)).toMatch(/must equal/i);
  });

  it("passes split with correct amounts (within 1 KSh tolerance)", () => {
    expect(validateCheckout(cart, "split", "", "", "300", "200", 500)).toBeNull();
  });

  it("passes mpesa sale (no customer data needed)", () => {
    expect(validateCheckout(cart, "mpesa", "", "", "", "", 500)).toBeNull();
  });
});

// ─── validateCartAdd ────────────────────────────────────────────────────────
describe("validateCartAdd", () => {
  it("rejects quantity exceeding remaining stock", () => {
    expect(validateCartAdd(6, 500, 500, 5, false)).toMatch(/5 units/);
  });

  it("passes when quantity equals remaining", () => {
    expect(validateCartAdd(5, 500, 500, 5, false)).toBeNull();
  });

  it("rejects sell price below base price when canEditPrice is true", () => {
    expect(validateCartAdd(1, 300, 500, 10, true)).toMatch(/cannot be less/i);
  });

  it("allows sell price equal to base price", () => {
    expect(validateCartAdd(1, 500, 500, 10, true)).toBeNull();
  });

  it("allows sell price above base price", () => {
    expect(validateCartAdd(1, 600, 500, 10, true)).toBeNull();
  });

  it("ignores price when canEditPrice is false", () => {
    // Even if sell price < base, fixed price mode shouldn't reject it
    expect(validateCartAdd(1, 300, 500, 10, false)).toBeNull();
  });
});

// ─── creditStatus ────────────────────────────────────────────────────────────
describe("creditStatus", () => {
  it("is paid when initPaid >= grandTotal", () => {
    expect(creditStatus(500, 500)).toBe("paid");
  });

  it("is paid when within 0.5 rounding tolerance", () => {
    expect(creditStatus(499.6, 500)).toBe("paid");
  });

  it("is partial when initPaid > 0 but < grandTotal", () => {
    expect(creditStatus(200, 500)).toBe("partial");
  });

  it("is pending when initPaid is 0", () => {
    expect(creditStatus(0, 500)).toBe("pending");
  });
});

// ─── normalisePhone ──────────────────────────────────────────────────────────
describe("normalisePhone", () => {
  it("handles 07XX format", () => {
    expect(normalisePhone("0712345678")).toBe("+254712345678");
  });

  it("handles 254 prefix", () => {
    expect(normalisePhone("254712345678")).toBe("+254712345678");
  });

  it("handles 9-digit format without country code", () => {
    expect(normalisePhone("712345678")).toBe("+254712345678");
  });

  it("handles spaces and dashes", () => {
    expect(normalisePhone("0712 345 678")).toBe("+254712345678");
  });

  it("returns null for invalid number", () => {
    expect(normalisePhone("abc")).toBeNull();
    expect(normalisePhone("12345")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalisePhone("")).toBeNull();
  });
});

// ─── hourLabel ───────────────────────────────────────────────────────────────
describe("hourLabel", () => {
  it("labels midnight-adjacent hours correctly", () => {
    expect(hourLabel(6)).toBe("6AM");
    expect(hourLabel(11)).toBe("11AM");
  });

  it("labels noon", () => {
    expect(hourLabel(12)).toBe("12PM");
  });

  it("labels PM hours", () => {
    expect(hourLabel(13)).toBe("1PM");
    expect(hourLabel(20)).toBe("8PM");
  });
});

// ─── calcCommission ──────────────────────────────────────────────────────────
describe("calcCommission", () => {
  it("returns 0 when sell price equals base price", () => {
    expect(calcCommission(500, 500, 2, 10)).toBe(0);
  });

  it("returns 0 when sell price is below base (clamped)", () => {
    expect(calcCommission(400, 500, 1, 10)).toBe(0);
  });

  it("calculates commission on markup", () => {
    // markup = 100, qty = 2, rate = 10% → 100 * 2 * 0.10 = 20
    expect(calcCommission(600, 500, 2, 10)).toBe(20);
  });

  it("rounds to nearest integer", () => {
    // markup = 33, qty = 1, rate = 10% → 3.3 → rounds to 3
    expect(calcCommission(533, 500, 1, 10)).toBe(3);
  });

  it("handles 0% commission rate", () => {
    expect(calcCommission(600, 500, 5, 0)).toBe(0);
  });
});
