// Post-login redirect targets must be same-site paths: no scheme, no protocol-relative, no control characters.
export function safeNext(v: unknown): string {
  return typeof v === 'string' && v.startsWith('/') && !/^\/[/\\]/.test(v) && !/[\u0000-\u001f\u007f]/.test(v) ? v : '/';
}

// An OAuth redirect back to this computer (how CLI agents receive the code). Anything else gets a warning on the consent page.
export function loopbackRedirect(uri: string): boolean {
  try {
    const h = new URL(uri).hostname;
    return h === 'localhost' || h === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(h);
  } catch {
    return false;
  }
}
