// Size maths for photos in the chat. Pure, so it is tested without a phone.

/** A sent photo: about 75% of the screen width, its own shape, never taller than the cap. */
export const SENT_PHOTO_WIDTH_RATIO = 0.75;
/** Height cap as a share of the screen height (and never more than 420 pt). */
export const SENT_PHOTO_MAX_HEIGHT_RATIO = 0.5;
export const SENT_PHOTO_MAX_HEIGHT = 420;
/** The preview in the input bar before sending. */
export const PREVIEW_SIZE = 96;
/** The remove button on the preview: big enough to hit (44 pt with its hit slop). */
export const REMOVE_BUTTON_SIZE = 28;

export interface Size {
  width: number;
  height: number;
}

/**
 * The on-screen size of a sent photo. Unknown or broken dimensions show a
 * square of the target width (capped), so the layout never jumps to zero.
 */
export function sentPhotoSize(screen: Size, photo: Partial<Size> | null | undefined): Size {
  const maxWidth = Math.round(Math.max(0, screen.width) * SENT_PHOTO_WIDTH_RATIO);
  const maxHeight = Math.round(Math.min(SENT_PHOTO_MAX_HEIGHT, Math.max(0, screen.height) * SENT_PHOTO_MAX_HEIGHT_RATIO));
  const w = photo?.width ?? 0;
  const h = photo?.height ?? 0;
  const ratio = w > 0 && h > 0 && Number.isFinite(w / h) ? w / h : 1;
  let width = maxWidth;
  let height = width / ratio;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * ratio;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

/** Full-screen view: fit inside the screen, keeping the shape. */
export function fitPhotoSize(screen: Size, photo: Partial<Size> | null | undefined): Size {
  const w = photo?.width ?? 0;
  const h = photo?.height ?? 0;
  const ratio = w > 0 && h > 0 ? w / h : 1;
  const byWidth = { width: screen.width, height: screen.width / ratio };
  const out = byWidth.height <= screen.height ? byWidth : { width: screen.height * ratio, height: screen.height };
  return { width: Math.round(out.width), height: Math.round(out.height) };
}

/** Pinch zoom stays between 1x and 4x. */
export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(4, Math.max(1, scale));
}
