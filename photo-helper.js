const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const abortError = () => new DOMException('Photo preparation stopped', 'AbortError');

// Decode locally and make a fresh JPEG. The outgoing file contains pixels only,
// without the original camera location or other embedded metadata.
export async function preparePrivatePhoto(file, {signal} = {}) {
  const check = () => { if (signal?.aborted) throw abortError(); };
  check();
  if (!file || !TYPES.has(file.type)) throw new Error('Choose a JPG, PNG or WebP picture. If your phone uses HEIC, choose a compatible copy.');
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('Choose a picture smaller than 20 MB.');
  let decoded;
  let temporaryURL;
  try {
    if (typeof createImageBitmap === 'function') {
      decoded = await createImageBitmap(file);
    } else {
      temporaryURL = URL.createObjectURL(file);
      decoded = await new Promise((resolve, reject) => {
        const image = new Image();
        const cleanup = () => { image.onload = null; image.onerror = null; signal?.removeEventListener('abort', cancel); };
        const cancel = () => { cleanup(); image.src = ''; reject(abortError()); };
        image.onload = () => { cleanup(); resolve(image); };
        image.onerror = () => { cleanup(); reject(new Error('This picture could not open. Try another JPG, PNG or WebP.')); };
        signal?.addEventListener('abort', cancel, {once:true});
        image.src = temporaryURL;
      });
    }
    check();
    const width = decoded.naturalWidth || decoded.width;
    const height = decoded.naturalHeight || decoded.height;
    if (!width || !height || width * height > 40_000_000) throw new Error('That picture is too large. Choose one below 40 megapixels.');
    const scale = Math.min(1, 1600 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare this picture. Try another picture.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(decoded, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.86, 0.7, 0.5]) {
      check();
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      check();
      if (blob?.size && blob.type === 'image/jpeg' && blob.size <= 3 * 1024 * 1024) {
        return new File([blob], 'private-photo.jpg', {type:'image/jpeg'});
      }
    }
    throw new Error('This picture is still too large to send. Try a smaller picture.');
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    if (error instanceof Error && error.message && !/decode|source image|encoding/i.test(error.message)) throw error;
    throw new Error('This picture could not open. Try another JPG, PNG or WebP.');
  } finally {
    decoded?.close?.();
    if (temporaryURL) URL.revokeObjectURL(temporaryURL);
  }
}
