/**
 * Pure 3-tier avatar resolution for a signed-in player in a given game:
 *   per-game override (PlayerAvatars) → global profile photo → none.
 *
 * `null` means "no photo" — the renderer falls back to the anonymous shape/color cosmetic.
 */

function firstNonBlank(...urls: (string | null | undefined)[]): string | null {
  for (const u of urls) {
    if (typeof u === "string" && u.trim() !== "") return u;
  }
  return null;
}

export function resolveGameAvatar(
  perGameUrl: string | null | undefined,
  globalUrl: string | null | undefined,
): string | null {
  return firstNonBlank(perGameUrl, globalUrl);
}
