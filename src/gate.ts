// Remembers, for this browser tab's session, that the visitor already went
// through the landing page, so a refresh doesn't replay it. A new tab or visit
// shows it again. Storage can be unavailable (private modes, blocked cookies),
// in which case the landing page simply shows every time.
export const ENTERED_KEY = "leeterboard:entered";

type Store = Pick<Storage, "getItem" | "setItem">;

export function sessionStore(): Store | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function hasEntered(store: Store | null): boolean {
  try {
    return store?.getItem(ENTERED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markEntered(store: Store | null): void {
  try {
    store?.setItem(ENTERED_KEY, "1");
  } catch {
    /* ignore: the landing page just shows again next time */
  }
}
