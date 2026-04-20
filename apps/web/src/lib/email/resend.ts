import { Resend } from "resend";

type SendOpts = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
};

export async function sendEmail(opts: SendOpts): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log("[email:stub]", JSON.stringify(opts, null, 2));
    return true;
  }

  const from = process.env.RESEND_FROM ?? "CADE League <noreply@cadeesports.com>";
  try {
    const client = new Resend(apiKey);
    const { error } = await client.emails.send({ from, ...opts });
    if (error) {
      console.error("[email:error]", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email:exception]", err);
    return false;
  }
}
