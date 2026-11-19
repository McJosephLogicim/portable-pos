/**
 * What a person sees when something fails. Messages the app wrote itself are kept.
 * Anything from the browser, the network or a library is swapped for plain words, so
 * no stack, code, table or field name ever reaches the screen.
 */

const fallback = "Something went wrong. Try again.";

function authText(error: Error & { status?: number; code?: string }) {
  const text = `${error.code ?? ""} ${error.message}`.toLowerCase();
  if (error.status === 429 || text.includes("rate") || text.includes("security purposes"))
    return "Too many tries. Wait a minute, then try again.";
  if (text.includes("invalid login") || text.includes("invalid_credentials"))
    return "That email or password isn't right.";
  if (text.includes("not confirmed")) return "Confirm your email first. The link is in your inbox.";
  if (text.includes("already registered") || text.includes("already exists"))
    return "That email already has an account. Sign in instead.";
  if (text.includes("password")) return "Use a longer password, at least 8 characters.";
  if (text.includes("email")) return "Check the email address.";
  return "Couldn't reach your account. Check the connection and try again.";
}

export function friendlyError(error: unknown, otherwise = fallback): string {
  if (!(error instanceof Error)) return otherwise;
  const name = error.name;
  if (name === "AbortError") return "That took too long. Try again.";
  if (name === "QuotaExceededError") return "This phone is out of storage. Free up some space and try again.";
  if (name.startsWith("Auth") || "__isAuthError" in error) return authText(error as Error & { status?: number });
  // DOMException, TypeError, SyntaxError and friends come from the browser, not from us.
  if (Object.getPrototypeOf(error) !== Error.prototype && !("status" in error)) return otherwise;
  const text = error.message.trim();
  if (!text || text.length > 240 || /[{}<>[\]]|https?:|\bat \S+ \(|undefined|null|NaN|\w+\.\w+\(/.test(text))
    return otherwise;
  return text;
}
