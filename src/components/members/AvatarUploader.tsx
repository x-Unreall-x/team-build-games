import { useRef, useState } from "react";
import { coverCropRect } from "../../lib/members/avatarCrop";

const SIZE = 256;

/** Loads a File into an <img>. */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read that image."));
    };
    img.src = objectUrl;
  });
}

/** Client-side resize + center-crop to a SIZE×SIZE PNG data URL. */
async function toSquarePng(file: File): Promise<string> {
  const img = await loadImage(file);
  const { sx, sy, side } = coverCropRect(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable.");
  ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
  return canvas.toDataURL("image/png");
}

export default function AvatarUploader({ currentUrl }: { currentUrl: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(currentUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setError("Please choose a JPG or PNG image.");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await toSquarePng(file);
      const res = await fetch("/api/avatar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Upload failed.");
      setUrl(body.avatarUrl ?? null);
      // Re-render the rest of the app (header, etc.) which reads the member server-side.
      setTimeout(() => window.location.reload(), 400);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {url ? (
        <img src={url} alt="Your avatar" width={64} height={64} style={{ borderRadius: 9999, objectFit: "cover" }} />
      ) : (
        <span
          style={{
            display: "flex",
            width: 64,
            height: 64,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 9999,
            background: "#e5e7eb",
            fontSize: 28,
          }}
        >
          🙂
        </span>
      )}
      <div>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {busy ? "Uploading…" : url ? "Change photo" : "Upload photo"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />
        <p className="mt-1 text-xs text-neutral-500">JPG or PNG — cropped to a square.</p>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
