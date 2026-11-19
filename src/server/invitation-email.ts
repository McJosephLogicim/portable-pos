import type { Business, RegisterResponse } from "../lib/types";

export async function sendInvitationEmail(
  business: Pick<Business, "id" | "name">,
  email: string,
): Promise<NonNullable<RegisterResponse["inviteDelivery"]>> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.POS_INVITE_FROM;
  const origin = process.env.POS_APP_URL;
  if (!key || !from || !origin) return "unavailable";

  try {
    const link = new URL("/", origin);
    if (link.protocol !== "https:") return "unavailable";
    link.searchParams.set("shifts", business.id);
    const businessName = business.name.replace(/\s+/g, " ").trim();
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "You're invited to a team on Portable POS",
        text: [
          `You've been invited to join ${businessName} on Portable POS.`,
          "Open the link and sign in with this email address. If you're new to Portable POS, create an account with this address and confirm it first.",
          link.href,
        ].join("\n\n"),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) return "sent";
    console.warn("Invitation email rejected by provider", response.status);
  } catch {
    console.warn("Invitation email provider request failed");
  }
  return "failed";
}
