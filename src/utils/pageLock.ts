/** One document lock with independent owners; release order never restores a stale lock. */
const owners = new Set<symbol>();
const inertOwners = new Map<HTMLElement, {count: number; previous: boolean}>();
let restorePage: (() => void) | undefined;

export function acquirePageLock(container?: HTMLElement | null): () => void {
  const token = Symbol('page overlay');
  if (!owners.size) {
    const body = document.body, html = document.documentElement;
    const y = window.scrollY, x = window.scrollX;
    const pathname = window.location.pathname;
    const old = {overflow: body.style.overflow, position: body.style.position, top: body.style.top, width: body.style.width};
    const htmlOverflow = html?.style.overflow;
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `${-y}px`;
    body.style.width = '100%';
    if (html) html.style.overflow = 'hidden';
    restorePage = () => {
      Object.assign(body.style, old);
      if (html) html.style.overflow = htmlOverflow ?? '';
      window.scrollTo({left: x, top: window.location.pathname === pathname ? y : 0, behavior: 'instant'});
    };
  }
  owners.add(token);
  const siblings: HTMLElement[] = [];
  let ancestor = container ?? null;
  while (ancestor?.parentElement) {
    for (const sibling of Array.from(ancestor.parentElement.children)) {
      if (sibling === ancestor || !(sibling instanceof HTMLElement)) continue;
      const entry = inertOwners.get(sibling) ?? {count: 0, previous: sibling.inert};
      entry.count++;
      inertOwners.set(sibling, entry);
      sibling.inert = true;
      siblings.push(sibling);
    }
    if (ancestor.parentElement === document.body) break;
    ancestor = ancestor.parentElement;
  }
  return () => {
    if (!owners.delete(token)) return;
    for (const sibling of siblings) {
      const entry = inertOwners.get(sibling)!;
      if (--entry.count === 0) {
        sibling.inert = entry.previous;
        inertOwners.delete(sibling);
      }
    }
    if (!owners.size) {
      restorePage?.();
      restorePage = undefined;
    }
  };
}

export function restoreOverlayFocus(previous: HTMLElement | null) {
  if (owners.size) return;
  const target = previous?.isConnected ? previous : document.querySelector<HTMLElement>('#nav-toggle');
  if (target && !target.closest('[inert]')) target.focus({preventScroll: true});
}
