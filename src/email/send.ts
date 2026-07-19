const RESEND_API_URL = "https://api.resend.com/emails";

export interface EmailConfig {
  apiKey: string;
  from: string;
  to: string;
}

export function loadEmailConfigFromEnv(): EmailConfig | null {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.EMAIL_TO;
  const from = process.env.EMAIL_FROM ?? "onboarding@resend.dev";

  if (!apiKey || !to) return null;
  return { apiKey, from, to };
}

export async function sendDigestEmail(
  config: EmailConfig,
  subject: string,
  text: string
): Promise<void> {
  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: [config.to],
      subject,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API error: ${res.status} ${res.statusText} ${body}`);
  }
}
