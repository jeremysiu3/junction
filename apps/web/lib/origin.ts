import { headers } from 'next/headers';

// Production pins the public origin so spoofed Host/X-Forwarded-Host can't poison invite links or OAuth metadata.
export function configuredOrigin(): string | undefined {
  return process.env.JUNCTION_APP_URL?.replace(/\/+$/, '') || undefined;
}

// next dev reports localhost even for a 127.0.0.1 request, so prefer the forwarded/Host headers.
export async function origin(): Promise<string> {
  const fixed = configuredOrigin();
  if (fixed) return fixed;
  const h = await headers();
  return `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('x-forwarded-host') ?? h.get('host')}`;
}
