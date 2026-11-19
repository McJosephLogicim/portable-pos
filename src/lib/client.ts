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
async function post(
  path: string,
  init: RequestInit,
  timeout: number,
  connectionError: string,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, {
      ...init,
      method: "POST",
      signal: controller.signal,
    });
    const text = await response.text();
    try {
      return { response, data: JSON.parse(text) };
    } catch {
      return { response, data: null };
    }
  } catch (error) {
    throw new Error(
      controller.signal.aborted
        ? "The server took too long to respond. Try again."
        : connectionError,
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
  }
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
  const token = session.access_token;
  async function send<T>(command: Record<string, unknown>): Promise<T> {
    const { response, data } = await post(
      "/api/pos",
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(command),
        cache: "no-store",
      },
      20_000,
      command.action === "bootstrap" || command.action === "historyPage"
        ? "Couldn't load the register. Check your connection and try again."
        : "Couldn't confirm the save. Check your connection and try again.",
    );
    if (!response.ok || !data)
      throw new RequestFailure(
        response.status,
        data?.error || "The register couldn't get a response. Try again.",
      );
    return data;
  }
  const data = await send<Bootstrap & { nextSales?: string }>(body);
  let cursor = data.nextSales;
  while (cursor) {
    const page = await send<{ sales: Sale[]; nextSales?: string }>({
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
  const { response, data } = await post(
    "/api/images",
    {
      headers: {
        "Content-Type": photo.type,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: photo,
    },
    30_000,
    "Couldn't upload the photo. Check your connection and try again.",
  );
  if (!response.ok || !data?.url)
    throw new RequestFailure(response.status, data?.error || "The photo didn't upload. Try again.");
  return data.url as string;
}
