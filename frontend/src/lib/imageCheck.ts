const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Check a chosen file before upload, for instant feedback. The server re-checks the real bytes. */
export function checkImage(file: File, maxBytes: number): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) return "Use a JPEG, PNG or WebP image.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > maxBytes) return `That photo is over ${Math.round(maxBytes / 1024 / 1024)} MB. Try a smaller one.`;
  return null;
}
