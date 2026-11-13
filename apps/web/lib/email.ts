// Resend when RESEND_API_KEY is set, else local Mailpit. A Resend failure logs its status only, never the key, recipient or body.
export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (key) {
    let outcome: string | null;
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ from: 'Junction <invites@junctionmcp.com>', to: [to], subject, text }),
        signal: AbortSignal.timeout(5000),
      });
      outcome = res.ok ? null : `HTTP ${res.status}`;
    } catch {
      outcome = 'network error';
    }
    if (outcome) console.error(`Resend email failed: ${outcome}`);
    return !outcome;
  }
  try {
    const res = await fetch(`${process.env.JUNCTION_MAIL_API ?? 'http://127.0.0.1:54324'}/api/v1/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ From: { Email: 'noreply@junction.local', Name: 'Junction' }, To: [{ Email: to }], Subject: subject, Text: text }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
