import React, { useEffect, useState } from "react";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

// The signed-in member's header button: their LeetCode profile picture and
// username. Clicking it toggles the account menu that drops down beneath it. Below the lg breakpoint
// only the picture is shown, to leave room for the other header controls.
export default function AccountButton({
  user,
  onClick,
  open = false
}: {
  user: { avatarUrl: string; displayName: string; leetcodeUsername: string };
  onClick: () => void;
  open?: boolean;
}) {
  // LeetCode avatars can be missing or fail to load; show the member's initial
  // instead of a broken image.
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [user.avatarUrl]);

  const showImage = !!user.avatarUrl && !broken;
  const initial = (user.displayName || user.leetcodeUsername).trim().charAt(0).toUpperCase() || "?";

  return (
    <button
      type="button"
      onClick={onClick}
      id="open-account-btn"
      aria-label={`Account menu (@${user.leetcodeUsername})`}
      aria-haspopup="menu"
      aria-expanded={open}
      title="Account"
      className={`inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full bg-ink-800 p-1 text-sm font-medium text-mist-100 ring-1 ring-line transition-colors hover:bg-ink-700 lg:pr-3.5 ${focusRing}`}
    >
      {showImage ? (
        <img
          src={user.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="size-7 shrink-0 rounded-full bg-ink-700 object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-full bg-teal-400 text-xs font-semibold text-ink-950"
        >
          {initial}
        </span>
      )}
      <span className="hidden max-w-[10rem] truncate lg:inline">@{user.leetcodeUsername}</span>
    </button>
  );
}
