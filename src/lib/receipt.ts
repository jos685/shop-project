import type { CartItem } from "../types/pos";
import { cartItemName } from "../types/pos";
import type { BusinessInfo } from "./useBusinessInfo";

export interface ReceiptItem {
  name: string;
  qty: number;
  unitPrice: number;
  total: number;
  unlisted: boolean;
}

export interface ReceiptData {
  ref: string;                 // "TXN-7484796B" or "CR-7484796B"
  timestamp: string;           // human formatted
  sellerName: string;
  customerName: string;
  customerPhone: string;
  items: ReceiptItem[];
  total: number;
  paymentMethod: string;       // "Cash" | "M-Pesa" | "Split" | "Pay Later"
  mpesaRef: string;
  isCredit: boolean;
  amountPaid: number;          // for credit: upfront paid
  balanceOwed: number;         // for credit: remaining
  isQueued: boolean;
  isBackdated: boolean;
}

export function buildReceiptData(input: {
  ref: string;
  timestamp: string;
  sellerName: string;
  customerName: string;
  customerPhone: string;
  cart: CartItem[];
  total: number;
  payMethod: string | null;
  mpesaRef: string;
  initialPayment: number;      // for credit
  isQueued: boolean;
  isBackdated: boolean;
}): ReceiptData {
  const isCredit = input.payMethod === "credit";
  const paid = isCredit ? Math.min(Math.max(0, input.initialPayment), input.total) : 0;

  const payLabel =
    input.payMethod === "cash"   ? "Cash"     :
    input.payMethod === "mpesa"  ? "M-Pesa"   :
    input.payMethod === "split"  ? "Split"    :
    input.payMethod === "credit" ? "Pay Later": "—";

  return {
    ref: input.ref,
    timestamp: input.timestamp,
    sellerName: input.sellerName,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    items: input.cart.map(item => ({
      name: cartItemName(item),
      qty: item.quantity,
      unitPrice: item.sellPrice,
      total: item.sellPrice * item.quantity,
      unlisted: item.kind === "unlisted",
    })),
    total: input.total,
    paymentMethod: payLabel,
    mpesaRef: input.mpesaRef,
    isCredit,
    amountPaid: paid,
    balanceOwed: isCredit ? Math.max(0, input.total - paid) : 0,
    isQueued: input.isQueued,
    isBackdated: input.isBackdated,
  };
}

// ── Filename helper ───────────────────────────────────────────────────
export function sanitizeFilename(s: string): string {
  return (s || "receipt")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "receipt";
}

export function receiptFilename(businessName: string, ref: string): string {
  const shop = sanitizeFilename(businessName);
  const r    = sanitizeFilename(ref.replace(/^[A-Z]+-/, ""));  // strip TXN-/CR- prefix
  const prefix = ref.startsWith("CR-") ? "CR" : "TXN";
  return `${shop}-${prefix}-${r}.pdf`;
}

// ── Money formatter ───────────────────────────────────────────────────
const ksh = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;

// ── Plain-text version (WhatsApp / clipboard) ─────────────────────────
export function receiptToText(d: ReceiptData, biz: BusinessInfo): string {
  const lines: string[] = [];
  lines.push(`*${biz.businessName || "Receipt"}*`);
  if (biz.phone) lines.push(biz.phone);
  lines.push("");
  lines.push(`Receipt: ${d.ref}`);
  lines.push(d.timestamp);
  lines.push(`Served by: ${d.sellerName}`);
  lines.push("─────────────────────");
  for (const it of d.items) {
    lines.push(`${it.qty}× ${it.name}`);
    lines.push(`   ${ksh(it.total)}`);
  }
  lines.push("─────────────────────");
  lines.push(`TOTAL: ${ksh(d.total)}`);
  if (d.isCredit) {
    lines.push(`Paid upfront: ${ksh(d.amountPaid)}`);
    lines.push(`*Balance owed: ${ksh(d.balanceOwed)}*`);
  }
  lines.push("");
  lines.push(`Payment: ${d.paymentMethod}${d.mpesaRef ? ` (${d.mpesaRef})` : ""}`);
  if (d.customerPhone) lines.push(`Customer: ${d.customerPhone}`);
  if (d.isQueued) lines.push("⏳ Will sync when online");
  lines.push("");
  lines.push(`Thank you for shopping at ${biz.businessName || "us"} 🙏`);
  return lines.join("\n");
}

// ── Print HTML (80mm thermal-friendly) ────────────────────────────────
export function receiptToPrintHtml(d: ReceiptData, biz: BusinessInfo, logoDataUrl: string | null): string {
  const esc = (s: string) =>
    s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

  const rows = d.items.map(it => `
    <tr>
      <td class="qty">${it.qty}×</td>
      <td class="name">${esc(it.name)}</td>
      <td class="amt">${ksh(it.total)}</td>
    </tr>`).join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(d.ref)}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body {
    font-family: ui-monospace, "DM Mono", Menlo, Consolas, monospace;
    color: #000; background: #fff;
    width: 80mm; padding: 4mm; margin: 0;
    font-size: 11px; line-height: 1.35;
  }
  .center { text-align: center; }
  .logo { max-height: 40px; max-width: 60mm; object-fit: contain; display: block; margin: 0 auto 4px; }
  .biz { font-size: 14px; font-weight: 800; letter-spacing: 0.02em; word-break: break-word; }
  .phone { font-size: 11px; margin-top: 2px; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: 1px 0; }
  td.qty { width: 8mm; }
  td.name { word-break: break-word; }
  td.amt { text-align: right; white-space: nowrap; }
  .row { display: flex; justify-content: space-between; gap: 6px; }
  .total { font-size: 15px; font-weight: 800; margin-top: 2px; }
  .credit-box { border: 1px solid #000; padding: 4px 6px; margin: 6px 0; }
  .credit-title { font-weight: 800; letter-spacing: 0.06em; font-size: 10px; }
  .thanks { margin-top: 8px; font-size: 11px; }
</style></head>
<body>
  ${logoDataUrl ? `<img class="logo" src="${logoDataUrl}" alt="" />` : ""}
  <div class="center">
    <div class="biz">${esc(biz.businessName || "")}</div>
    ${biz.phone ? `<div class="phone">${esc(biz.phone)}</div>` : ""}
  </div>
  <hr />
  <div class="row"><span>${esc(d.ref)}</span></div>
  <div class="row"><span>${esc(d.timestamp)}</span></div>
  <div class="row"><span>Served by:</span><span>${esc(d.sellerName)}</span></div>
  <hr />
  <table>${rows}</table>
  <hr />
  <div class="row"><span>TOTAL</span><span class="total">${ksh(d.total)}</span></div>
  ${d.isCredit ? `
    <div class="credit-box">
      <div class="credit-title">CREDIT SALE</div>
      <div class="row"><span>Paid upfront</span><span>${ksh(d.amountPaid)}</span></div>
      <div class="row"><span>Balance owed</span><span><strong>${ksh(d.balanceOwed)}</strong></span></div>
    </div>` : ""}
  <hr />
  <div class="row"><span>Payment</span><span>${esc(d.paymentMethod)}</span></div>
  ${d.mpesaRef ? `<div class="row"><span>M-Pesa ref</span><span>${esc(d.mpesaRef)}</span></div>` : ""}
  ${d.customerName  ? `<div class="row"><span>Customer</span><span>${esc(d.customerName)}</span></div>` : ""}
  ${d.customerPhone ? `<div class="row"><span>Phone</span><span>${esc(d.customerPhone)}</span></div>` : ""}
  ${d.isQueued ? `<div class="row"><span>Status</span><span>Pending sync</span></div>` : ""}
  <hr />
  <div class="center thanks">Thank you for shopping at<br/><strong>${esc(biz.businessName || "")}</strong></div>
</body></html>`;
}

// ── PDF via jspdf (lazy-loaded) ───────────────────────────────────────
export async function receiptToPdf(
  d: ReceiptData,
  biz: BusinessInfo,
  opts: { save?: boolean } = { save: true }
): Promise<void> {
  const { jsPDF } = await import("jspdf");

  const doc = new jsPDF({ unit: "mm", format: "a5", orientation: "portrait" });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const M = 12;
  const W = PAGE_W - M * 2;
  let y = M;

  // ── Logo (skipped silently on SVG / fetch failure) ──
  let logoDataUrl: string | null = null;
  const logoUrl = biz.logoUrl;
  const isSvg = logoUrl ? /\.svg(\?|$)/i.test(logoUrl) : false;
  if (logoUrl && !isSvg) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(logoUrl, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) {
        const blob = await res.blob();
        logoDataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onloadend = () => resolve(String(r.result));
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
      }
    } catch { logoDataUrl = null; }
  }

  if (logoDataUrl) {
    try {
      // Fit within 60mm wide × 20mm tall, centered
      const img = (doc as any).getImageProperties(logoDataUrl);
      const maxW = 60, maxH = 20;
      const ratio = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * ratio, h = img.height * ratio;
      doc.addImage(logoDataUrl, "PNG", (PAGE_W - w) / 2, y, w, h, undefined, "FAST");
      y += h + 3;
    } catch { /* bad image — skip */ }
  }

  // ── Business header ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  const bizName = biz.businessName || "";
  const bizLines = doc.splitTextToSize(bizName, W) as string[];
  for (const line of bizLines) {
    doc.text(line, PAGE_W / 2, y, { align: "center" });
    y += 6;
  }

  if (biz.phone) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(biz.phone, PAGE_W / 2, y, { align: "center" });
    y += 5;
  }

  y += 1;
  doc.setDrawColor(180);
  doc.line(M, y, PAGE_W - M, y);
  y += 5;

  // ── Meta rows ──
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const metaRow = (label: string, value: string) => {
    doc.setTextColor(120);
    doc.text(label, M, y);
    doc.setTextColor(20);
    const v = doc.splitTextToSize(value, W - 40) as string[];
    doc.text(v, PAGE_W - M, y, { align: "right" });
    y += 5.5 * v.length;
  };
  metaRow("Receipt", d.ref);
  metaRow("Date", d.timestamp);
  metaRow("Served by", d.sellerName);

  y += 1;
  doc.setDrawColor(180);
  doc.line(M, y, PAGE_W - M, y);
  y += 5;

  // ── Items ──
  const colName = M;
  const colQty  = M + W * 0.62;
  const colAmt  = PAGE_W - M;

  const ensureSpace = (need: number) => {
    if (y + need > PAGE_H - M) {
      doc.addPage();
      y = M;
    }
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text("ITEM",  colName, y);
  doc.text("QTY",   colQty,  y, { align: "right" });
  doc.text("TOTAL", colAmt,  y, { align: "right" });
  y += 4;
  doc.setTextColor(20);

  for (const it of d.items) {
    const nameLines = doc.splitTextToSize(it.name, W * 0.58) as string[];
    const rowH = Math.max(5.5, nameLines.length * 5);
    ensureSpace(rowH + 2);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(nameLines, colName, y);
    doc.text(String(it.qty), colQty, y, { align: "right" });
    doc.text(ksh(it.total),  colAmt, y, { align: "right" });
    y += rowH;
  }

  y += 1;
  doc.setDrawColor(180);
  doc.line(M, y, PAGE_W - M, y);
  y += 6;

  // ── Total ──
  ensureSpace(12);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("TOTAL", M, y);
  doc.setFontSize(16);
  doc.text(ksh(d.total), PAGE_W - M, y, { align: "right" });
  y += 8;

  // ── Credit block ──
  if (d.isCredit) {
    ensureSpace(20);
    doc.setDrawColor(120);
    doc.roundedRect(M, y, W, 16, 1.5, 1.5);
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text("CREDIT SALE", M + 3, y + 4.5);
    doc.setTextColor(20);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Paid upfront", M + 3, y + 10);
    doc.text(ksh(d.amountPaid), PAGE_W - M - 3, y + 10, { align: "right" });
    doc.text("Balance owed", M + 3, y + 14);
    doc.setFont("helvetica", "bold");
    doc.text(ksh(d.balanceOwed), PAGE_W - M - 3, y + 14, { align: "right" });
    y += 20;
  }

  // ── Payment meta ──
  ensureSpace(30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text("Payment", M, y);
  doc.setTextColor(20);
  doc.text(d.paymentMethod, PAGE_W - M, y, { align: "right" });
  y += 5.5;

  if (d.mpesaRef) {
    doc.setTextColor(120); doc.text("M-Pesa ref", M, y);
    doc.setTextColor(20);  doc.text(d.mpesaRef, PAGE_W - M, y, { align: "right" });
    y += 5.5;
  }
  if (d.customerName) {
    doc.setTextColor(120); doc.text("Customer", M, y);
    doc.setTextColor(20);  doc.text(d.customerName, PAGE_W - M, y, { align: "right" });
    y += 5.5;
  }
  if (d.customerPhone) {
    doc.setTextColor(120); doc.text("Phone", M, y);
    doc.setTextColor(20);  doc.text(d.customerPhone, PAGE_W - M, y, { align: "right" });
    y += 5.5;
  }
  if (d.isQueued) {
    doc.setTextColor(180, 120, 0);
    doc.text("Status", M, y);
    doc.text("Pending sync", PAGE_W - M, y, { align: "right" });
    y += 5.5;
  }

  // ── Footer ──
  y += 4;
  doc.setDrawColor(180);
  doc.line(M, y, PAGE_W - M, y);
  y += 6;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(10);
  doc.setTextColor(80);
  const thanks = `Thank you for shopping at ${biz.businessName || "us"}!`;
  const thanksLines = doc.splitTextToSize(thanks, W) as string[];
  for (const line of thanksLines) {
    doc.text(line, PAGE_W / 2, y, { align: "center" });
    y += 5;
  }

  if (opts.save !== false) {
    doc.save(receiptFilename(biz.businessName, d.ref));
  }
}