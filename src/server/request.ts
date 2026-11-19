import { RegisterError } from "./errors";

// Stay under Vercel's 4.5 MB function payload ceiling, including on requests
// sent without a Content-Length header.
const maxBytes = 4_000_000;

export async function readCommand(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new RegisterError(400, "That request didn't come through right. Reload the app and try again.");
  let bytes = 0;
  let json = "";
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new RegisterError(
          413,
          "This request is too large. Send fewer items together.",
        );
      }
      json += decoder.decode(value, { stream: true });
    }
    return JSON.parse(json + decoder.decode());
  } catch (error) {
    if (error instanceof RegisterError) throw error;
    throw new RegisterError(400, "That request didn't come through right. Reload the app and try again.");
  } finally {
    reader.releaseLock();
  }
}
