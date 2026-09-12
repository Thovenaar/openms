/** Validate the transferred PNG buffer and expected atlas dimensions. */
function validateRequest(id, buffer, width, height) {
  if (
    !Number.isSafeInteger(id) ||
    !(buffer instanceof ArrayBuffer) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 2048 ||
    height > 2048 ||
    buffer.byteLength > 32 * 1024 * 1024
  ) {
    throw new Error("Invalid decode request");
  }
}

/** Dedicated PNG decoding; at most two requests are admitted by the owning pool. */
async function decode(event) {
  const { id, buffer, width, height } = event.data;
  let bitmap;
  try {
    validateRequest(id, buffer, width, height);
    bitmap = await createImageBitmap(
      new Blob([buffer], { type: "image/png" }),
      {
        premultiplyAlpha: "premultiply",
        colorSpaceConversion: "none",
      },
    );
    if (bitmap.width !== width || bitmap.height !== height) {
      throw new Error("Decoded atlas dimensions mismatch");
    }
    self.postMessage({ id, bitmap }, [bitmap]);
  } catch (error) {
    bitmap?.close();
    self.postMessage({ id, error: error.message });
  }
}
self.addEventListener("message", decode);
