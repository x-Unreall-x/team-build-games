import type { APIRoute } from "astro";
import { auth } from "@wix/essentials";
import { files } from "@wix/media";
import { members } from "@wix/members";
import { getContextualAuth } from "@wix/sdk-runtime/context";

const MAX_BYTES = 400_000; // client sends a 256×256 png — comfortably under this

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Decode a base64 string to bytes without Node's Buffer (edge/fetch runtime). */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Trusted avatar upload (Track B B1). A signed-in member POSTs a small square png/jpeg data URL;
 * we upload it to Wix Media (elevated — clients can't write media directly) and set it as the
 * member's profile photo, so `getSessionMember()` surfaces it everywhere. One avatar per member.
 */
export const POST: APIRoute = async ({ request }) => {
  // 1) must be a signed-in member
  let loggedIn = false;
  try {
    loggedIn = (getContextualAuth() as { loggedIn?: () => boolean }).loggedIn?.() === true;
  } catch {
    loggedIn = false;
  }
  if (!loggedIn) return json({ error: "Sign in to set an avatar." }, 401);

  let memberId: string | undefined;
  try {
    memberId = (await members.getCurrentMember())?.member?._id ?? undefined;
  } catch {
    memberId = undefined;
  }
  if (!memberId) return json({ error: "Could not resolve your member account." }, 401);

  // 2) parse + validate the image (a data URL produced by the client-side resize/crop)
  let dataUrl = "";
  try {
    ({ dataUrl = "" } = await request.json());
  } catch {
    return json({ error: "Malformed request." }, 400);
  }
  const match = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(dataUrl);
  if (!match) return json({ error: "Expected a PNG or JPEG image." }, 400);
  const mimeType = match[1]!;
  const bytes = base64ToBytes(match[2]!);
  if (bytes.byteLength > MAX_BYTES) return json({ error: "Image too large." }, 413);

  // 3) upload to Wix Media (Manage Media Manager → elevated)
  const ext = mimeType === "image/png" ? "png" : "jpg";
  const fileName = `avatar-${memberId}.${ext}`;
  let avatarUrl: string | undefined;
  try {
    const { uploadUrl } = await auth.elevate(files.generateFileUploadUrl)(mimeType, { fileName, private: false });
    const put = await fetch(`${uploadUrl}?filename=${encodeURIComponent(fileName)}`, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      // Uint8Array is a valid fetch body at runtime; the lib's BodyInit type is narrower.
      body: bytes as unknown as BodyInit,
    });
    if (!put.ok) return json({ error: "Media upload failed." }, 502);
    const { file } = await put.json();
    avatarUrl = file?.url;
  } catch {
    return json({ error: "Media upload failed." }, 502);
  }
  if (!avatarUrl) return json({ error: "Media upload returned no URL." }, 502);

  // 4) store as the member's profile photo (Manage Members → elevated)
  try {
    await auth.elevate(members.updateMember)(memberId, {
      profile: { photo: { url: avatarUrl, width: 256, height: 256 } },
    });
  } catch {
    // Uploaded, but couldn't persist to the profile — surface it so the photo shape can be adjusted.
    return json({ avatarUrl, warning: "uploaded-but-not-saved" }, 200);
  }

  return json({ avatarUrl }, 200);
};
