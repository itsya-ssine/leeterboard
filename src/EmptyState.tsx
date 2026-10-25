import React from "react";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300";

const actionCls = `inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-teal-400 to-sky-400 px-3.5 text-sm font-medium text-ink-950 shadow-[0_0_0_1px_rgb(255_255_255/0.12)_inset,0_6px_20px_-6px_rgb(45_212_191/0.6)] transition hover:brightness-110 active:scale-[0.97] ${focusRing}`;

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
      className={`${bare ? "" : "card-aurora animate-rise"} px-6 py-14 text-center ${className}`}
    >
      <div className="animate-float mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-tint text-teal-300 ring-1 ring-line">
        {icon}
      </div>
      <p className="font-medium text-strong">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-mist-500">{description}</p>}
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
