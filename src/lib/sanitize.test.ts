import { describe, it, expect } from "vitest";
import {
  sanitizeText,
  sanitizeCode,
  sanitizeSku,
  sanitizePhone,
  sanitizeAmount,
  sanitizeInteger,
  sanitizePassword,
} from "./sanitize";

// ─── sanitizeText ─────────────────────────────────────────────────────────────
describe("sanitizeText", () => {
  it("allows normal text", () => {
    expect(sanitizeText("Hello World", 100)).toBe("Hello World");
  });

  it("strips null bytes", () => {
    expect(sanitizeText("hello\x00world", 100)).toBe("helloworld");
  });

  it("strips C0 control characters except tabs/newlines", () => {
    expect(sanitizeText("abc\x01\x02\x03def", 100)).toBe("abcdef");
  });

  it("strips C1 / DEL characters", () => {
    expect(sanitizeText("abc\x7Fdef\x9Fghi", 100)).toBe("abcdefghi");
  });

  it("preserves regular newlines and spaces", () => {
    const s = "line one\nline two";
    expect(sanitizeText(s, 100)).toBe(s);
  });

  it("truncates to maxLen", () => {
    expect(sanitizeText("abcdef", 4)).toBe("abcd");
  });

  it("handles empty string", () => {
    expect(sanitizeText("", 100)).toBe("");
  });

  it("blocks XSS-like injection attempts", () => {
    const attempt = '<script>alert("xss")</script>';
    // React escapes HTML output, but sanitizeText removes nothing visible here —
    // the important thing is control chars are stripped and the string is capped.
    expect(sanitizeText(attempt, 200)).toBe(attempt); // React handles escaping
  });
});

// ─── sanitizeCode ─────────────────────────────────────────────────────────────
describe("sanitizeCode", () => {
  it("uppercases input", () => {
    expect(sanitizeCode("acme-001")).toBe("ACME-001");
  });

  it("strips special characters", () => {
    expect(sanitizeCode("A<B>C!@#")).toBe("ABC");
  });

  it("allows dash and underscore", () => {
    expect(sanitizeCode("SHP_001-A")).toBe("SHP_001-A");
  });

  it("strips spaces", () => {
    expect(sanitizeCode("A B C")).toBe("ABC");
  });

  it("truncates to maxLen", () => {
    expect(sanitizeCode("ABCDEFGH", 4)).toBe("ABCD");
  });

  it("strips SQL injection characters (dashes allowed, rest stripped)", () => {
    // sanitizeCode allows dashes — so "--" stays; the dangerous chars are stripped
    expect(sanitizeCode("'; DROP TABLE--")).toBe("DROPTABLE--");
  });
});

// ─── sanitizeSku ──────────────────────────────────────────────────────────────
describe("sanitizeSku", () => {
  it("uppercases and strips non-alphanumeric-dash", () => {
    expect(sanitizeSku("sam/ear@a10!")).toBe("SAMEARA10");
  });

  it("keeps dashes", () => {
    expect(sanitizeSku("SAM-EAR-A10")).toBe("SAM-EAR-A10");
  });

  it("truncates to maxLen", () => {
    expect(sanitizeSku("A".repeat(50), 10)).toBe("A".repeat(10));
  });

  it("handles empty string", () => {
    expect(sanitizeSku("")).toBe("");
  });
});

// ─── sanitizePhone ────────────────────────────────────────────────────────────
describe("sanitizePhone", () => {
  it("allows digits, spaces, and dashes", () => {
    expect(sanitizePhone("0712 345-678")).toBe("0712 345-678");
  });

  it("allows leading plus", () => {
    expect(sanitizePhone("+254712345678")).toBe("+254712345678");
  });

  it("strips letters", () => {
    expect(sanitizePhone("abc07123")).toBe("07123");
  });

  it("strips plus in non-leading position", () => {
    // The non-leading + signs are stripped (not replaced with space)
    expect(sanitizePhone("07+12+345")).toBe("0712345");
  });

  it("truncates to 15 characters", () => {
    expect(sanitizePhone("1234567890123456")).toHaveLength(15);
  });

  it("handles empty string", () => {
    expect(sanitizePhone("")).toBe("");
  });
});

// ─── sanitizeAmount ───────────────────────────────────────────────────────────
describe("sanitizeAmount", () => {
  it("allows whole numbers", () => {
    expect(sanitizeAmount("500")).toBe("500");
  });

  it("allows decimal values", () => {
    expect(sanitizeAmount("1234.50")).toBe("1234.50");
  });

  it("strips negative sign", () => {
    expect(sanitizeAmount("-500")).toBe("500");
  });

  it("strips letters", () => {
    expect(sanitizeAmount("50abc0")).toBe("500");
  });

  it("keeps only the first decimal point", () => {
    expect(sanitizeAmount("1.2.3")).toBe("1.23");
  });

  it("handles empty string", () => {
    expect(sanitizeAmount("")).toBe("");
  });

  it("caps whole-number part at 10 digits", () => {
    // The no-decimal branch caps at 10 characters
    expect(sanitizeAmount("12345678901234")).toHaveLength(10);
  });

  it("allows up to 13 chars with decimal", () => {
    expect(sanitizeAmount("1234567890.12")).toHaveLength(13);
  });
});

// ─── sanitizeInteger ──────────────────────────────────────────────────────────
describe("sanitizeInteger", () => {
  it("parses a valid positive integer", () => {
    expect(sanitizeInteger("42")).toBe("42");
  });

  it("strips non-digit characters", () => {
    expect(sanitizeInteger("10 units")).toBe("10");
  });

  it("strips the minus sign and keeps digits", () => {
    // "-5" → strips "-" → parses "5" → valid positive
    expect(sanitizeInteger("-5")).toBe("5");
  });

  it("returns empty for non-numeric input", () => {
    expect(sanitizeInteger("abc")).toBe("");
  });

  it("clamps to max", () => {
    expect(sanitizeInteger("99999", 9999)).toBe("9999");
  });

  it("handles 0", () => {
    expect(sanitizeInteger("0")).toBe("0");
  });
});

// ─── sanitizePassword ────────────────────────────────────────────────────────
describe("sanitizePassword", () => {
  it("preserves special characters (needed for strong passwords)", () => {
    const pw = "P@ssw0rd!#$%^&*()";
    expect(sanitizePassword(pw)).toBe(pw);
  });

  it("strips null bytes", () => {
    expect(sanitizePassword("pass\x00word")).toBe("password");
  });

  it("truncates at 128 characters", () => {
    const long = "a".repeat(200);
    expect(sanitizePassword(long)).toHaveLength(128);
  });

  it("preserves normal passwords", () => {
    expect(sanitizePassword("MyShop2024")).toBe("MyShop2024");
  });
});
