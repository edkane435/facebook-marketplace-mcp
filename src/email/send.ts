import nodemailer from "nodemailer";

export interface EmailConfig {
  user: string;
  appPassword: string;
  to: string;
}

export function loadEmailConfigFromEnv(): EmailConfig | null {
  const user = process.env.SMTP_USER;
  const appPassword = process.env.SMTP_APP_PASSWORD;
  const to = process.env.EMAIL_TO ?? user;

  if (!user || !appPassword || !to) return null;
  return { user, appPassword, to };
}

export async function sendDigestEmail(
  config: EmailConfig,
  subject: string,
  text: string
): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: config.user,
      pass: config.appPassword,
    },
  });

  await transporter.sendMail({
    from: config.user,
    to: config.to,
    subject,
    text,
  });
}
