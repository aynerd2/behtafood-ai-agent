// Photo input: the app resizes the photo (longest edge 1024 px, JPEG) before
// sending, and checks it with the same rule as the server: JPEG or PNG, at
// most 1.5 MB, and the bytes must really be that kind of image.

export const PHOTO_MAX_BYTES = 1_500_000;
export const PHOTO_MAX_EDGE = 1024;
export const PHOTO_JPEG_QUALITY = 0.7;
export const PHOTO_REFUSAL = 'Photos must be JPEG or PNG and at most 1.5 MB.';

const DATA_URL = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/;

export function checkPhoto(dataUrl: string): boolean {
  const m = DATA_URL.exec(dataUrl);
  if (!m) return false;
  const data = m[2]!;
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  if (Math.floor((data.length * 3) / 4) - padding > PHOTO_MAX_BYTES) return false;
  const head = atob(data.slice(0, 8));
  const isPng = head.charCodeAt(0) === 0x89 && head.slice(1, 4) === 'PNG';
  const isJpeg = head.charCodeAt(0) === 0xff && head.charCodeAt(1) === 0xd8 && head.charCodeAt(2) === 0xff;
  return m[1] === 'image/png' ? isPng : isJpeg;
}

/** The size to draw at: longest edge at most PHOTO_MAX_EDGE, shape kept, never enlarged. */
export function scaledSize(width: number, height: number, max = PHOTO_MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
