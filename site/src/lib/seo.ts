export const SITE_ORIGIN = 'https://chicagobudget.com';

/** Public URL policy shared by Astro metadata and the post-assembly sitemap. */
export function canonicalPath(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0] || '/';
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error(`Invalid site path: ${pathname}`);
  if (path === '/') return path;
  if (path.replace(/\/+$/, '') === '/methods') return '/methods';
  return `${path.replace(/\/+$/, '')}/`;
}

export function canonicalUrl(pathname: string): string {
  return `${SITE_ORIGIN}${canonicalPath(pathname)}`;
}

export function isInternalRoute(pathname: string): boolean {
  return /^\/(?:find|box-shell)(?:\/|$)/.test(pathname);
}
