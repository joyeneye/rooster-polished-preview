import {renderPhotoEffects} from './photo-effects.js';
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const abortError = () => new DOMException('Photo preparation stopped', 'AbortError');

// Decode locally and make a fresh JPEG. The outgoing file contains pixels only,
// without the original camera location or other embedded metadata.
export async function prepareAlbumPhoto(file, {signal, effects, maxSide = 1200} = {}) {
  const check = () => { if (signal?.aborted) throw abortError(); };
  check();
  if (!file || !TYPES.has(file.type)) throw new Error('Choose a JPG, PNG or WebP picture. If your phone uses HEIC, choose a compatible copy.');
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('Choose a picture smaller than 20 MB.');
  let decoded;
  let temporaryURL;
  try {
    if (typeof createImageBitmap === 'function') {
      try { decoded = await createImageBitmap(file); } catch { /* Native Image can support camera formats the bitmap decoder cannot. */ }
    }
    if (!decoded) {
      temporaryURL = URL.createObjectURL(file);
      decoded = await new Promise((resolve, reject) => {
        const image = new Image();
        const cleanup = () => { image.onload = null; image.onerror = null; signal?.removeEventListener('abort', cancel); };
        const cancel = () => { cleanup(); image.src = ''; reject(abortError()); };
        image.onload = () => { cleanup(); resolve(image); };
        image.onerror = () => { cleanup(); reject(new Error('This phone cannot open that picture here. Choose a JPG, PNG or WebP copy from your library.')); };
        signal?.addEventListener('abort', cancel, {once:true});
        image.src = temporaryURL;
      });
    }
    check();
    const width = decoded.naturalWidth || decoded.width;
    const height = decoded.naturalHeight || decoded.height;
    if (!width || !height || width * height > 64_000_000) throw new Error('That picture is too large. Choose one below 64 megapixels.');
    const side = Number.isFinite(maxSide) ? Math.max(64, Math.min(1200, maxSide)) : 1200;
    const scale = Math.min(1, side / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare this picture. Try another picture.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(decoded, 0, 0, canvas.width, canvas.height);
    renderPhotoEffects(context, canvas.width, canvas.height, effects);
    for (const quality of [0.82, 0.68, 0.52]) {
      check();
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      check();
      if (blob?.size && blob.type === 'image/jpeg' && blob.size <= 800 * 1024) {
        return new File([blob], 'album-photo.jpg', {type:'image/jpeg'});
      }
    }
    throw new Error('This picture is still too large to send. Try a smaller picture.');
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    if (error instanceof Error && error.message && !/decode|source image|encoding/i.test(error.message)) throw error;
    throw new Error('This phone cannot open that picture here. Choose a JPG, PNG or WebP copy from your library.');
  } finally {
    decoded?.close?.();
    if (temporaryURL) URL.revokeObjectURL(temporaryURL);
  }
}
