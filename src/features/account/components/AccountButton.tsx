import React, { useEffect, useState } from "react";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400";

// The signed-in member's header button: their LeetCode profile picture and
// username. Clicking it toggles the account menu that drops down beneath it. Below the lg breakpoint
// only the picture is shown, to leave room for the other header controls.
export default function AccountButton({
  user,
  onClick,
  open = false
}: {
  user: { avatarUrl: string; displayName: string; loginUsername: string };
  onClick: () => void;
  open?: boolean;
}) {
  // LeetCode avatars can be missing or fail to load; show the member's initial
  // instead of a broken image.
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [user.avatarUrl]);

  const showImage = !!user.avatarUrl && !broken;
  const initial = (user.displayName || user.loginUsername).trim().charAt(0).toUpperCase() || "?";

  return (
    <button
      type="button"
      onClick={onClick}
      id="open-account-btn"
      aria-label={`Account menu (@${user.loginUsername})`}
      aria-haspopup="menu"
      aria-expanded={open}
      title="Account"
      className={`flex h-9 shrink-0 cursor-pointer items-center gap-2 border-2 border-ink-700 bg-ink-900 p-1 text-sm font-medium text-mist-100 shadow-[2px_2px_0_#000] transition-colors hover:border-mist-400 hover:bg-ink-800 lg:pr-3 ${focusRing}`}
    >
      {showImage ? (
        <img
          src={user.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="size-6 shrink-0 border border-ink-700 bg-ink-800 object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="grid size-6 shrink-0 place-items-center bg-emerald-400 font-pixel text-[10px] font-bold text-ink-950"
        >
          {initial}
        </span>
      )}
      <span className="hidden max-w-[10rem] truncate font-mono text-xs font-semibold lg:inline">
        @{user.loginUsername}
      </span>
    </button>
  );
}
