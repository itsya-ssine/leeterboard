import React from "react";
import { Search, X } from "lucide-react";

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
        className="h-10 w-full border-2 border-ink-700 bg-ink-950 pl-9 pr-8 text-sm font-sans text-mist-100 shadow-[2px_2px_0_#000] transition placeholder:text-mist-500 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-mist-500 hover:text-mist-100"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
