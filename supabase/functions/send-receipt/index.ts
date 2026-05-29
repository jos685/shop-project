// @ts-nocheck — Deno runtime, not Node. VS Code can't resolve deno.land URLs.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("254") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+254${digits.slice(1)}`;
  if (digits.length === 9) return `+254${digits}`;
  return null;
}

function formatDateTime(d: Date): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const day   = d.getDate();
  const month = months[d.getMonth()];
  const year  = d.getFullYear();
  const h24   = d.getHours();
  const min   = String(d.getMinutes()).padStart(2, "0");
  const ampm  = h24 >= 12 ? "PM" : "AM";
  const h12   = String(h24 % 12 || 12).padStart(2, "0");
  return `${day} ${month} ${year}, ${h12}:${min} ${ampm}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const {
      phone,
      business_name,
      agent_name,
      items,
      total_amount,
      payment_method,
      mpesa_ref,
      initial_payment,   // credit: amount paid upfront / so far
      balance_due,       // credit: remaining balance
      customer_name,     // credit: customer name
      message_type,      // "credit_sale" | "credit_statement" | undefined (regular)
    } = await req.json();

    const normalized = normalizePhone(phone ?? "");
    if (!normalized) {
      return new Response(
        JSON.stringify({ sent: false, reason: "invalid_phone" }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const itemLines = (items as { name: string; quantity: number; unit_price: number; total: number }[])
      .map(i => `${i.name} x${i.quantity} - KSh ${Number(i.total).toLocaleString()}`)
      .join("\n");

    const dateStr = formatDateTime(new Date());
    const isCredit = payment_method === "credit" || message_type === "credit_sale" || message_type === "credit_statement";
    const isStatement = message_type === "credit_statement";

    let message: string;

    if (isCredit) {
      const paid    = Number(initial_payment ?? 0);
      const balance = Number(balance_due ?? total_amount);
      const label   = isStatement ? "[ CREDIT STATEMENT ]" : "[ CREDIT SALE ]";
      const paidLabel  = isStatement ? "Paid So Far" : "Paid Now";

      const lines = [
        `Thank you for choosing ${business_name}!`,
        label,
        "────────────",
        itemLines,
        "────────────",
        `Total: KSh ${Number(total_amount).toLocaleString()}`,
        ...(paid > 0 ? [`${paidLabel}: KSh ${paid.toLocaleString()}`] : []),
        `Amount to Pay: KSh ${balance.toLocaleString()}`,
      ];
      if (!isStatement && agent_name) lines.push(`Agent: ${agent_name}`);
      lines.push(`Date: ${dateStr}`);
      lines.push("────────────");
      lines.push(`Please pay KSh ${balance.toLocaleString()} to clear your balance. Thank you!`);
      message = lines.join("\n");
    } else {
      const paymentLine =
        payment_method === "mpesa" ? `M-Pesa${mpesa_ref ? ` (${mpesa_ref})` : ""}` :
        payment_method === "split" ? `Cash + M-Pesa${mpesa_ref ? ` (${mpesa_ref})` : ""}` :
        "Cash";

      message = [
        `Thank you for choosing ${business_name}!`,
        "────────────",
        itemLines,
        "────────────",
        `Total: KSh ${Number(total_amount).toLocaleString()}`,
        `Payment: ${paymentLine}`,
        ...(agent_name ? [`Agent: ${agent_name}`] : []),
        `Date: ${dateStr}`,
        "────────────",
        "Thank you for your purchase!",
      ].join("\n");
    }

    const AT_USERNAME  = Deno.env.get("AT_USERNAME")!;
    const AT_API_KEY   = Deno.env.get("AT_API_KEY")!;
    const AT_SENDER_ID = Deno.env.get("AT_SENDER_ID") ?? "";

    const body = new URLSearchParams({
      username: AT_USERNAME,
      to:       normalized,
      message,
    });
    if (AT_SENDER_ID) body.set("from", AT_SENDER_ID);

    const atRes = await fetch("https://api.africastalking.com/version1/messaging", {
      method:  "POST",
      headers: {
        apiKey:         AT_API_KEY,
        Accept:         "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const atData = await atRes.json();
    const recipients = atData?.SMSMessageData?.Recipients ?? [];
    const success    = recipients.length > 0 && recipients[0]?.status === "Success";

    return new Response(
      JSON.stringify({ sent: success, recipients, raw: atData }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ sent: false, reason: String(err) }),
      { headers: { ...CORS, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
