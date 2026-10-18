export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers
    }
  });
}

export async function readJson(request, maxBytes = 20000) {
  const type = request.headers.get("content-type") || "";
  if (!type.includes("application/json")) throw new HttpError(415, "Send the request as JSON.");
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request too large.");
  try { return JSON.parse(text || "{}"); } catch { throw new HttpError(400, "Invalid request."); }
}

// Blocks form posts from other websites (cross-site request forgery).
export function checkSameOrigin(request, url) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== url.host) throw new HttpError(403, "Request from another site was blocked.");
}

export const clientIp = request =>
  request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
