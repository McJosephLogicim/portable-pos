/** Shrink a camera photo to a square-ish JPEG small enough to sync and cache offline. */
export async function compressPhoto(file: File, size = 640, quality = 0.8): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw Error("Choose a photo.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw Error("That photo couldn't be read. Try another.");
  });
  const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw Error("This browser can't resize photos.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  for (let q = quality; q >= 0.4; q -= 0.15) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", q));
    if (blob && blob.size <= 380_000) return blob;
  }
  throw Error("That photo is too large. Try another.");
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(url: string): Blob {
  const [head, body] = url.split(",");
  const type = head.match(/^data:([^;]+)/)?.[1] ?? "image/jpeg";
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type });
}
