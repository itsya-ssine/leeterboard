import React from "react";

// Pulsing placeholders that mirror the real layouts, so a page keeps its shape
// while data loads. They use the same aurora cards as the finished pages.

function Bone({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded bg-ink-800 ${className}`} />;
}

function Busy({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

function TileSkeleton() {
  return (
    <div className="card-aurora p-5">
      <div className="flex items-start justify-between gap-2">
        <Bone className="h-3 w-24" />
        <Bone className="size-8 rounded-lg" />
      </div>
      <Bone className="mt-4 h-8 w-20" />
      <Bone className="mt-3 h-3 w-32" />
    </div>
  );
}

function PanelSkeleton({ className = "", height = "h-48" }: { className?: string; height?: string }) {
  return (
    <div className={`card-aurora p-5 ${className}`}>
      <Bone className="h-3 w-28" />
      <Bone className="mt-2 h-3 w-48" />
      <Bone className={`mt-5 w-full rounded-lg ${height}`} />
    </div>
  );
}

// Member profile: hero card, stat tiles and the progress chart.
export function ProfileSkeleton() {
  return (
    <Busy label="Loading profile" className="space-y-4">
      <div className="card-aurora overflow-hidden">
        <div className="h-24 animate-pulse bg-ink-800/70 md:h-32" aria-hidden="true" />
        <div className="px-5 pb-6 md:px-8">
          <div className="-mt-12 flex items-end justify-between md:-mt-14">
            <Bone className="size-24 rounded-full ring-4 ring-ink-900 md:size-28" />
            <div className="flex gap-2">
              <Bone className="size-9 rounded-lg" />
              <Bone className="size-9 rounded-lg" />
              <Bone className="size-9 rounded-lg" />
            </div>
          </div>
          <Bone className="mt-4 h-7 w-56" />
          <Bone className="mt-2 h-4 w-32" />
          <div className="mt-5 flex gap-2 border-t border-line pt-4">
            <Bone className="h-6 w-28 rounded-full" />
            <Bone className="h-6 w-20 rounded-full" />
            <Bone className="h-6 w-24 rounded-full" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <TileSkeleton key={i} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <PanelSkeleton className="lg:col-span-2" height="h-56" />
        <PanelSkeleton height="h-56" />
      </div>
    </Busy>
  );
}

// Head to head: the two pickers, a stat table and the history chart.
export function CompareSkeleton() {
  return (
    <Busy label="Loading members" className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="card-aurora flex items-center gap-4 p-5">
            <Bone className="size-14 rounded-full" />
            <div className="min-w-0 flex-1">
              <Bone className="h-5 w-40" />
              <Bone className="mt-2 h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
      <div className="card-aurora divide-y divide-line">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 px-5 py-3.5">
            <Bone className="h-4 w-16" />
            <Bone className="h-3 w-24" />
            <Bone className="h-4 w-16" />
          </div>
        ))}
      </div>
      <PanelSkeleton height="h-56" />
    </Busy>
  );
}

// Account settings: header, avatar strip and the settings cards.
export function AccountSkeleton() {
  return (
    <Busy label="Checking your session" className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <Bone className="h-3 w-40" />
        <Bone className="mt-4 h-10 w-72" />
        <Bone className="mt-3 h-4 w-80 max-w-full" />
      </div>
      <div className="card-aurora flex items-center gap-4 p-4">
        <Bone className="size-14 rounded-full" />
        <div>
          <Bone className="h-4 w-32" />
          <Bone className="mt-2 h-3 w-64 max-w-full" />
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-6">
          <PanelSkeleton height="h-20" />
          <PanelSkeleton height="h-28" />
        </div>
        <div className="flex flex-col gap-6">
          <PanelSkeleton height="h-36" />
          <PanelSkeleton height="h-20" />
        </div>
      </div>
    </Busy>
  );
}

// Generic list-style card (admin dashboard, message history, ...).
export function ListSkeleton({
  label = "Loading",
  rows = 5,
  bare = false
}: {
  label?: string;
  rows?: number;
  // Skip the card when the list sits inside one already.
  bare?: boolean;
}) {
  return (
    <Busy label={label} className={`${bare ? "" : "card-aurora"} divide-y divide-line`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Bone className="size-10 rounded-full" />
          <Bone className="h-4 w-40" />
          <Bone className="ml-auto h-4 w-16" />
        </div>
      ))}
    </Busy>
  );
}
