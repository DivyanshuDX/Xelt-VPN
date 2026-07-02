/** Build the redirect target for the browser-signing page. */
export function payPageRedirect(queryString: string): string {
  const base = (process.env.PAY_PAGE_BASE || 'http://localhost:1421').replace(/\/$/, '');
  const qs = queryString ? `?${queryString}` : '';
  return `${base}/pay.html${qs}`;
}
