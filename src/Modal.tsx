import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { X } from "lucide-react";

// Count of mounted modals, so scroll stays locked while one dialog is
// animating out and another is already animating in.
let openModals = 0;

interface ModalProps {
  onClose: () => void;
  label: string;
  id?: string;
  maxWidth?: string;
  // false = no close button, and Escape or a click outside do nothing. For a
  // dialog that is the whole screen, like the sign-in screen.
  dismissible?: boolean;
  children: React.ReactNode;
}

export default function Modal({ onClose, label, id, maxWidth = "max-w-md", dismissible = true, children }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Remember trigger to return focus on close (WCAG 2.2 AA)
    triggerRef.current = document.activeElement as HTMLElement | null;

    // Focus first interactive element inside dialog
    const focusTimer = setTimeout(() => {
      if (modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length > 0) focusable[0].focus();
        else modalRef.current.focus();
      }
    }, 40);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab" && modalRef.current) {
        const focusable = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      if (triggerRef.current && typeof triggerRef.current.focus === "function") {
        triggerRef.current.focus();
      }
    };
  }, [onClose, dismissible]);

  useEffect(() => {
    openModals += 1;
    document.body.style.overflow = "hidden";
    return () => {
      openModals -= 1;
      if (openModals === 0) document.body.style.overflow = "";
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={dismissible ? onClose : undefined}
        className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm"
      />

      <motion.div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        id={id}
        tabIndex={-1}
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className={`relative z-10 w-full ${maxWidth} border-2 border-ink-600 bg-ink-900 shadow-[6px_6px_0_#000] focus:outline-none`}
      >
        <div className="flex max-h-[90vh] flex-col overflow-hidden">
          {/* Retro window header strip */}
          <div className="relative flex items-center justify-between border-b-2 border-ink-700 bg-ink-950 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="size-2 bg-emerald-400 shadow-[0_0_4px_#34d399]" />
              <span className="font-pixel text-[11px] font-bold uppercase tracking-wider text-mist-400">
                {label}
              </span>
            </div>
            {dismissible && (
              <button
                type="button"
                onClick={onClose}
                className="grid size-7 cursor-pointer place-items-center border-2 border-ink-700 bg-ink-800 text-mist-400 shadow-[1px_1px_0_#000] transition-colors hover:border-mist-400 hover:bg-ink-700 hover:text-mist-100 focus-visible:outline-2 focus-visible:outline-teal-400"
                aria-label="Close dialog"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <div className="relative min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
