import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, X } from "lucide-react";
import { PixelCheck, PixelSkull } from "../../pixelArt.js";

export type ToastKind = "success" | "error";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ToastApi {
  toast: (kind: ToastKind, message: string) => void;
}

const ToastContext = createContext<ToastApi>({ toast: () => {} });

export const useToast = () => useContext(ToastContext);

const SHOW_MS = 3500;
const SHOW_ERROR_MS = 6000;
const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      setItems((all) => [...all.slice(-(MAX_VISIBLE - 1)), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), kind === "error" ? SHOW_ERROR_MS : SHOW_MS);
    },
    [dismiss]
  );

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-stretch gap-2.5 sm:inset-x-auto sm:right-4 sm:w-88"
      >
        <AnimatePresence initial={false}>
          {items.map((t) => {
            const isError = t.kind === "error";
            return (
              <motion.div
                key={t.id}
                layout
                role={isError ? "alert" : "status"}
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="pointer-events-auto shadow-[4px_4px_0_#000]"
              >
                <div
                  className={`overflow-hidden border-2 bg-ink-900 ${
                    isError ? "border-rose-500/80 shadow-[3px_3px_0_#4c0519]" : "border-emerald-500/80 shadow-[3px_3px_0_#022c22]"
                  }`}
                >
                  <div className="flex items-start gap-3 px-4 py-3">
                    <span
                      className={`mt-0.5 grid size-6 shrink-0 place-items-center border ${
                        isError
                          ? "border-rose-500/60 bg-rose-950/60 text-rose-300"
                          : "border-emerald-500/60 bg-emerald-950/60 text-emerald-300"
                      }`}
                    >
                      {isError ? (
                        <PixelSkull size={14} color="#f43f5e" />
                      ) : (
                        <PixelCheck size={12} className="text-emerald-400" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className={`block font-pixel text-[9px] uppercase tracking-wider mb-0.5 ${
                        isError ? "text-rose-400" : "text-emerald-400"
                      }`}>
                        {isError ? "System Alert" : "Success"}
                      </span>
                      <p className="break-words text-sm font-sans text-mist-100">{t.message}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => dismiss(t.id)}
                      aria-label="Dismiss"
                      className="-mr-1 grid size-6 shrink-0 cursor-pointer place-items-center border border-ink-700 bg-ink-800 text-mist-500 transition-colors hover:border-mist-400 hover:text-mist-100"
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </div>
                  <div
                    aria-hidden="true"
                    className={`h-1 ${isError ? "bg-rose-500" : "bg-emerald-400"}`}
                  />
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
