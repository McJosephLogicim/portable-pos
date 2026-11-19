import { createClient } from "@supabase/supabase-js";
import { ensure, RegisterError } from "./errors";

export async function authenticatedOwner(request: Request) {
  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/i)?.[1];
  ensure(bearer, "Sign in to connect this register.", 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new RegisterError(503, "The account service is unavailable.");
  const auth = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await auth.auth.getUser(bearer);
  if (error && (error.status ?? 500) >= 500)
    throw new RegisterError(
      503,
      "The account service could not be reached. Try again.",
    );
  ensure(
    !error && data.user && !data.user.is_anonymous,
    "Please sign in again to sync your register.",
    401,
  );
  // The business picked in the app, when the person is on more than one.
  const businessId = request.headers.get("x-business-id")?.trim();
  return {
    id: data.user.id,
    ...(businessId && /^[0-9a-f-]{36}$/i.test(businessId) ? { businessId } : {}),
    // Only a confirmed address can claim a team invite.
    email: data.user.email_confirmed_at ? data.user.email ?? null : null,
  };
}
