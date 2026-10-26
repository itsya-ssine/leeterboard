import React, { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Settings, UserRound } from "lucide-react";
import { useAuth } from "./AuthContext.js";
import TierAvatar from "./TierAvatar.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

const rowCls = `group flex h-10 items-center gap-3 rounded-lg px-2 text-sm font-medium text-mist-100 transition-colors hover:bg-tint ${focusRing}`;
const iconTile =
  "grid size-7 shrink-0 place-items-center rounded-lg bg-tint text-teal-300 ring-1 ring-line transition-colors group-hover:ring-line-strong";

// The small menu that drops down under the header's account button. Everything
// you can change lives on the account settings page (#/account); this just
// points there and to the member's public profile.
//
// It positions itself against its nearest `relative` ancestor, so render it
// next to the AccountButton inside a `relative` wrapper.
export default function AccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      // The account button toggles the menu itself; don't close and re-open it.
      if ((target as Element).closest?.("#open-account-btn")) return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open, onClose]);

  if (!user) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          id="account-modal"
          role="menu"
          aria-label="Account"
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: 0.12 }}
          className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] origin-top-right shadow-2xl shadow-black/60"
        >
          <div className="card-aurora overflow-hidden">
            <div className="flex items-center gap-3 border-b border-line bg-gradient-to-r from-teal-400/15 via-sky-400/5 to-transparent px-4 py-3.5">
              <TierAvatar user={user} className="size-11" />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold tracking-tight text-strong">{user.displayName}</p>
                <p className="truncate font-mono text-xs text-mist-500">@{user.leetcodeUsername}</p>
              </div>
            </div>

            <nav aria-label="Account" className="flex flex-col gap-0.5 p-2">
              <div className="px-2 pb-1 pt-0.5 font-mono text-[10px] uppercase tracking-widest text-mist-500">{"// account"}</div>
              <a
                href={`#/u/${encodeURIComponent(user.leetcodeUsername)}`}
                onClick={onClose}
                id="account-profile-link"
                role="menuitem"
                className={rowCls}
              >
                <span className={iconTile}>
                  <UserRound className="size-4" aria-hidden="true" />
                </span>
                View profile
                <ChevronRight className="ml-auto size-4 text-mist-500 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </a>
              <a href="#/account" onClick={onClose} id="account-settings-link" role="menuitem" className={rowCls}>
                <span className={iconTile}>
                  <Settings className="size-4" aria-hidden="true" />
                </span>
                Account settings
                <ChevronRight className="ml-auto size-4 text-mist-500 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </a>
            </nav>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
