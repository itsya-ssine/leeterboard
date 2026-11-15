import React from "react";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400";

const actionCls = `inline-flex h-9 cursor-pointer items-center justify-center gap-2 border-2 border-emerald-600 bg-emerald-400 px-4 text-xs font-pixel font-bold uppercase text-ink-950 shadow-[2px_2px_0_#022c22] transition-transform hover:brightness-110 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${focusRing}`;

export interface EmptyAction {
  label: string;
  href?: string;
  onClick?: () => void;
  icon?: React.ReactNode;
}

// An icon tile, a title, one line of help and (optionally) one clear action.
// `bare` drops the card so it can sit inside an existing card or table.
export default function EmptyState({
  icon,
  title,
  description,
  action,
  bare = false,
  id,
  className = ""
}: {
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: EmptyAction;
  bare?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <div
      id={id}
      className={`${bare ? "" : "pixel-card"} px-6 py-14 text-center ${className}`}
    >
      <div className="mx-auto mb-4 grid size-14 place-items-center border-2 border-ink-700 bg-ink-950 text-teal-400 shadow-[3px_3px_0_#000]">
        {icon}
      </div>
      <p className="font-pixel text-xs uppercase tracking-wider text-mist-100">{title}</p>
      {description && <p className="mx-auto mt-2 max-w-md text-sm text-mist-400 font-sans">{description}</p>}
      {action &&
        (action.href ? (
          <a href={action.href} className={`${actionCls} mt-5`}>
            {action.icon}
            {action.label}
          </a>
        ) : (
          <button type="button" onClick={action.onClick} className={`${actionCls} mt-5`}>
            {action.icon}
            {action.label}
          </button>
        ))}
    </div>
  );
}
