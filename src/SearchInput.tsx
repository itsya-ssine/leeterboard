import React from "react";
import { Search } from "lucide-react";

// The search box above a leaderboard. Same look as the LeetCode board's.
export default function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  id
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  id: string;
}) {
  return (
    <div className="relative flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist-500" aria-hidden="true" />
      <input
        type="text"
        id={id}
        placeholder={placeholder}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-lg bg-ink-950 pl-9 pr-3 text-sm text-mist-100 ring-1 ring-line transition placeholder:text-mist-500 focus:outline-none focus:ring-2 focus:ring-teal-400"
      />
    </div>
  );
}
