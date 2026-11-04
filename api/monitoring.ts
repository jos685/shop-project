// api/monitoring.ts
import { handleTunnelRequest } from "@sentry/core";

export const config = {
  runtime: 'edge', 
};

// Your FULL Sentry DSN (from your Sentry.init call)
const SENTRY_DSN = "https://fee0bf91979cd5948e9f5fdcec8ca473@o4512328803287040.ingest.de.sentry.io/4512336967434320";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    // The helper now correctly receives the Request object and the allowed DSNs.
    // It will automatically validate, parse, and forward the envelope.
    return await handleTunnelRequest({
      request,
      allowedDsns: [SENTRY_DSN],
    });
  } catch (error) {
    console.error("[Sentry Tunnel] Unexpected error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}