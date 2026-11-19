import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Bootstrap, Sale } from "./types";

export class RequestFailure extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

let client: SupabaseClient | undefined;
export const accountsEnabled = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
);
export function authClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw Error(
      "Live accounts require a configured Supabase connection. The demo register is available on this device.",
    );
  return (client ??= createClient(url, key));
}
export async function api(
  userId: string,
  body: Record<string, unknown>,
): Promise<Bootstrap> {
  const {
    data: { session },
    error,
  } = await authClient().auth.getSession();
  if (error || !session || session.user.id !== userId)
    throw Error("Sign back into this owner account to sync this register.");
  async function post<T>(command: Record<string, unknown>): Promise<T> {
    const response = await fetch("/api/pos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session!.access_token}`,
      },
      body: JSON.stringify(command),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data)
      throw new RequestFailure(
        response.status,
        data?.error || "The register could not reach the server. Try again.",
      );
    return data;
  }
  const data = await post<Bootstrap & { nextSales?: string }>(body);
  let cursor = data.nextSales;
  while (cursor) {
    const page = await post<{ sales: Sale[]; nextSales?: string }>({
      action: "historyPage",
      cursor,
    });
    data.sales.push(...page.sales);
    cursor = page.nextSales;
  }
  return data;
}

/** Upload a photo and return the address it is served from. */
export async function uploadImage(userId: string, photo: Blob): Promise<string> {
  const {
    data: { session },
    error,
  } = await authClient().auth.getSession();
  if (error || !session || session.user.id !== userId)
    throw Error("Sign back into this owner account to add photos.");
  const response = await fetch("/api/images", {
    method: "POST",
    headers: { "Content-Type": photo.type, Authorization: `Bearer ${session.access_token}` },
    body: photo,
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.url)
    throw new RequestFailure(response.status, data?.error || "The photo didn't upload. Try again.");
  return data.url as string;
}
