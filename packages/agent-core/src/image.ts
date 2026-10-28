// Photo input: one JPEG or PNG per customer message, as a base64 data URL.
// Checked by type, by the file's own first bytes (so a renamed file is
// refused) and by size, before anything reaches the model.

export const MAX_IMAGE_BYTES = 1_500_000;

export type ImageCheck =
  | { ok: true; mime: 'image/jpeg' | 'image/png'; bytes: number }
  | { ok: false; reason: 'bad_type' | 'too_large' | 'not_an_image' };

const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

export function checkImageDataUrl(url: string): ImageCheck {
  const m = DATA_URL.exec(url);
  if (!m) return { ok: false, reason: 'bad_type' };
  const mime = m[1];
  const data = m[2]!;
  if (mime !== 'image/jpeg' && mime !== 'image/png') return { ok: false, reason: 'bad_type' };
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  const bytes = Math.floor((data.length * 3) / 4) - padding;
  if (bytes > MAX_IMAGE_BYTES) return { ok: false, reason: 'too_large' };
  const head = atob(data.slice(0, 8));
  const code = (i: number) => head.charCodeAt(i);
  const isPng = code(0) === 0x89 && head.slice(1, 4) === 'PNG';
  const isJpeg = code(0) === 0xff && code(1) === 0xd8 && code(2) === 0xff;
  if (mime === 'image/png' ? !isPng : !isJpeg) return { ok: false, reason: 'not_an_image' };
  return { ok: true, mime, bytes };
}

export const IMAGE_REFUSAL = 'Photos must be JPEG or PNG and at most 1.5 MB.';
