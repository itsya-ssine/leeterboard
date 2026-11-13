import React, { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Settings, UserRound } from "lucide-react";
import { useAuth } from "./AuthContext.js";
import TierAvatar from "./TierAvatar.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-dashed focus-visible:outline-pixel-teal";

const rowCls = `group flex h-11 items-center gap-3 rounded-none border-b border-pixel-border px-3 font-mono text-base font-bold text-pixel-text transition-none hover:bg-pixel-surface-alt hover:text-pixel-teal ${focusRing}`;
const iconTile =
  "grid size-7 shrink-0 place-items-center rounded-none border border-pixel-dark bg-pixel-surface text-pixel-teal";

// The small pixel menu that drops down under the header's account button.
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
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.08, ease: "linear" }}
          className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] origin-top-right rounded-none border-3 border-pixel-dark bg-pixel-surface shadow-[4px_4px_0_0_var(--color-pixel-dark)]"
        >
          <div className="overflow-hidden">
            <div className="flex items-center gap-3 border-b-2 border-pixel-dark bg-pixel-surface-alt px-4 py-3">
              <TierAvatar user={user} className="size-10" />
              <div className="min-w-0">
                <p className="truncate font-pixel text-xs font-bold text-pixel-text">{user.displayName}</p>
                <p className="truncate font-mono text-sm text-pixel-muted">@{user.loginUsername}</p>
              </div>
            </div>

            <nav aria-label="Account" className="flex flex-col">
              <div className="border-b border-pixel-border px-3 py-1 font-pixel text-[9px] uppercase tracking-wider text-pixel-muted">
                // ACCOUNT
              </div>
              <a
                href={`#/u/${encodeURIComponent(user.loginUsername)}`}
                onClick={onClose}
                id="account-profile-link"
                role="menuitem"
                className={rowCls}
              >
                <span className={iconTile}>
                  <UserRound className="size-4" aria-hidden="true" />
                </span>
                VIEW PROFILE
                <ChevronRight className="ml-auto size-4 text-pixel-muted" aria-hidden="true" />
              </a>
              <a href="#/account" onClick={onClose} id="account-settings-link" role="menuitem" className={rowCls}>
                <span className={iconTile}>
                  <Settings className="size-4" aria-hidden="true" />
                </span>
                ACCOUNT SETTINGS
                <ChevronRight className="ml-auto size-4 text-pixel-muted" aria-hidden="true" />
              </a>
            </nav>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
