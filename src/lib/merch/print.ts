/**
 * Print payload for score merch (pure). The title/subtitle travel from the
 * game-over screen through the shop as query params, so everything is
 * sanitized here: uppercase, charset-restricted, length-clamped, and passed
 * through a small profanity filter (player names end up on shirts).
 */

export interface PrintPayload {
  title: string;
  sub: string;
}

export const TITLE_MAX = 24;
export const SUB_MAX = 36;

export const DEFAULT_PAYLOAD: PrintPayload = {
  title: "TEAMBUILD GAMES",
  sub: "THE OFFICE ARCADE",
};

// The pixel font ships uppercase Latin + digits + basic punctuation only.
const ALLOWED = /[^A-Z0-9 .·:#!?'&+-]/g;

// Light internal blocklist — this is an office wall, not the open internet.
const BLOCKLIST = ["FUCK", "SHIT", "CUNT", "BITCH", "ASSHOLE", "DICK", "NAZI"];

function clean(raw: string, max: number): string {
  let text = raw.toUpperCase().replace(ALLOWED, "").replace(/\s+/g, " ").trim();
  for (const word of BLOCKLIST) {
    if (text.includes(word)) {
      text = text.replaceAll(word, "*".repeat(word.length));
    }
  }
  return text.slice(0, max).trim();
}

/** Sanitize a raw (query-param) payload; empty results fall back to defaults. */
export function sanitizePayload(raw: { title?: string; sub?: string }): PrintPayload {
  const title = clean(raw.title ?? "", TITLE_MAX);
  const sub = clean(raw.sub ?? "", SUB_MAX);
  return {
    title: title || DEFAULT_PAYLOAD.title,
    sub: sub || DEFAULT_PAYLOAD.sub,
  };
}

/** Build the shop URL that carries a payload into the merch funnel. */
export function buildShopUrl(product: string, payload: PrintPayload): string {
  const params = new URLSearchParams({ title: payload.title, sub: payload.sub });
  return `/shop/${product}?${params.toString()}`;
}
