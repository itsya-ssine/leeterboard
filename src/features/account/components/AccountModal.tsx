import React, { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Settings, UserRound } from "lucide-react";
import { useAuth } from "../../../AuthContext.js";
import TierAvatar from "../../../components/ui/TierAvatar.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400";

const rowCls = `group flex h-10 items-center gap-3 px-2.5 text-sm font-medium text-mist-100 transition-colors border border-transparent hover:border-ink-700 hover:bg-ink-800 ${focusRing}`;
const iconTile =
  "grid size-7 shrink-0 place-items-center border border-ink-700 bg-ink-950 text-teal-400 transition-colors group-hover:border-teal-400";

// The small menu that drops down under the header's account button. Everything
// you can change lives on the account settings page (#/account); this just
// points there and to the member's public profile.
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
          initial={{ opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.1 }}
          className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] origin-top-right border-2 border-ink-600 bg-ink-900 shadow-[4px_4px_0_#000]"
        >
          <div className="overflow-hidden">
            <div className="flex items-center gap-3 border-b-2 border-ink-700 bg-ink-950 px-4 py-3">
              <TierAvatar user={user} className="size-10" />
              <div className="min-w-0">
                <p className="truncate font-sans text-sm font-bold text-mist-100">{user.displayName}</p>
                <p className="truncate font-mono text-xs text-teal-400">@{user.loginUsername}</p>
              </div>
            </div>

            <nav aria-label="Account" className="flex flex-col gap-1 p-2">
              <div className="px-2 py-1 font-pixel text-[9px] uppercase tracking-wider text-mist-500">
                User Controls
              </div>
              <a
                href={`#/u/${encodeURIComponent(user.loginUsername)}`}
                onClick={onClose}
                id="account-profile-link"
                role="menuitem"
                className={rowCls}
              >
                <span className={iconTile}>
                  <UserRound className="size-3.5" aria-hidden="true" />
                </span>
                <span className="font-sans text-sm">View profile</span>
                <ChevronRight className="ml-auto size-3.5 text-mist-500 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </a>
              <a href="#/account" onClick={onClose} id="account-settings-link" role="menuitem" className={rowCls}>
                <span className={iconTile}>
                  <Settings className="size-3.5" aria-hidden="true" />
                </span>
                <span className="font-sans text-sm">Account settings</span>
                <ChevronRight className="ml-auto size-3.5 text-mist-500 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </a>
            </nav>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
