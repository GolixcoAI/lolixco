/** Extract one public video identifier. Never forward the caller's URL to a server. */
export function youtubeReferenceId(input: string): string | null {
 try {
  const value = new URL(input.trim());
  if (value.protocol !== 'https:' || value.username || value.password || value.port) return null;
  const path = value.pathname.split('/').filter(Boolean);
  let id: string | null = null;
  if (value.hostname === 'youtu.be' && path.length === 1) id = path[0];
  if (['youtube.com','www.youtube.com','m.youtube.com','www.youtube-nocookie.com'].includes(value.hostname)) {
   if (path.length === 1 && path[0] === 'watch') id = value.searchParams.get('v');
   if (path.length === 2 && ['shorts','embed','live'].includes(path[0])) id = path[1];
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
 } catch {
  return null;
 }
}
