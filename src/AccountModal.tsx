import React from "react";
import { AnimatePresence } from "motion/react";
import { ChevronRight, Settings, UserRound } from "lucide-react";
import { useAuth } from "./AuthContext.js";
import Modal from "./Modal.js";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

const rowCls = `flex h-11 items-center gap-3 rounded-lg bg-ink-800 px-3 text-sm font-medium text-mist-100 ring-1 ring-line transition-colors hover:bg-ink-700 ${focusRing}`;

// The small menu behind the header's account button. Everything you can change
// lives on the account settings page (#/account); this just points there and
// to the member's public profile.
export default function AccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <AnimatePresence>
      {open && (
        <Modal onClose={onClose} label="Account" maxWidth="max-w-sm" id="account-modal">
          <div className="flex items-center gap-3 pr-8">
            <img
              src={user.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="size-12 shrink-0 rounded-full bg-ink-800 object-cover"
            />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold tracking-tight text-strong">{user.displayName}</p>
              <p className="truncate text-sm text-mist-500">@{user.leetcodeUsername}</p>
            </div>
          </div>

          <nav aria-label="Account" className="mt-5 flex flex-col gap-2">
            <a
              href={`#/u/${encodeURIComponent(user.leetcodeUsername)}`}
              onClick={onClose}
              id="account-profile-link"
              className={rowCls}
            >
              <UserRound className="size-4 text-teal-300" aria-hidden="true" />
              View profile
              <ChevronRight className="ml-auto size-4 text-mist-500" aria-hidden="true" />
            </a>
            <a href="#/account" onClick={onClose} id="account-settings-link" className={rowCls}>
              <Settings className="size-4 text-teal-300" aria-hidden="true" />
              Account settings
              <ChevronRight className="ml-auto size-4 text-mist-500" aria-hidden="true" />
            </a>
          </nav>
        </Modal>
      )}
    </AnimatePresence>
  );
}
