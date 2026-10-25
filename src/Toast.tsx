import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, X } from "lucide-react";

type ToastKind = "success" | "error";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  toast: (kind: ToastKind, message: string) => void;
}

// Outside a provider the hook is a no-op, so components using it never crash.
const ToastContext = createContext<ToastApi>({ toast: () => {} });

export const useToast = () => useContext(ToastContext);

const SHOW_MS = 3500;
const SHOW_ERROR_MS = 6000;
const MAX_VISIBLE = 4;

// Small bottom-right messages for things that just happened (saved, copied,
// linked). Errors that need fixing in place stay inline next to their form.
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
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-4 sm:w-80"
      >
        <AnimatePresence initial={false}>
          {items.map((t) => {
            const isError = t.kind === "error";
            return (
              <motion.div
                key={t.id}
                layout
                role={isError ? "alert" : "status"}
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="pointer-events-auto shadow-2xl shadow-black/60"
              >
                <div className="card-aurora overflow-hidden">
                  <div className="flex items-start gap-3 px-4 py-3">
                    <span
                      className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg ring-1 ${
                        isError
                          ? "bg-rose-500/10 text-rose-300 ring-rose-400/30"
                          : "bg-teal-400/10 text-teal-300 ring-teal-400/30"
                      }`}
                    >
                      {isError ? (
                        <AlertTriangle className="size-3.5" aria-hidden="true" />
                      ) : (
                        <Check className="size-3.5" aria-hidden="true" />
                      )}
                    </span>
                    <p className="min-w-0 flex-1 break-words text-sm text-mist-100">{t.message}</p>
                    <button
                      type="button"
                      onClick={() => dismiss(t.id)}
                      aria-label="Dismiss"
                      className="-mr-1 grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-mist-500 transition-colors hover:bg-tint hover:text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  <div
                    aria-hidden="true"
                    className={`h-0.5 bg-gradient-to-r ${isError ? "from-rose-400" : "from-teal-300"} to-transparent`}
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
