import { sendEmail } from "@/lib/email/resend";

type User = { email: string; display_name: string };
type Session = { ip_address: string | null; user_agent: string | null; started_at: string };

export async function sendNewDeviceAlert(user: User, session: Session): Promise<boolean> {
  const subject = "New device login on your CADE League admin account";
  const html = `
    <p>Hi ${user.display_name},</p>
    <p>A login to your CADE League admin account just happened from a device we haven't seen before.</p>
    <ul>
      <li><b>Time:</b> ${session.started_at}</li>
      <li><b>IP:</b> ${session.ip_address ?? "(unknown)"}</li>
      <li><b>Browser:</b> ${session.user_agent ?? "(unknown)"}</li>
    </ul>
    <p>If this was you, nothing to do. If not, reset your password immediately from the dashboard.</p>
  `.trim();
  const text = `New device login at ${session.started_at} from ${session.ip_address ?? "unknown IP"}.`;
  return sendEmail({ to: user.email, subject, html, text });
}
