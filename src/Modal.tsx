import React, { useEffect } from "react";
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
  children: React.ReactNode;
}

export default function Modal({ onClose, label, id, maxWidth = "max-w-md", children }: ModalProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    openModals += 1;
    document.body.style.overflow = "hidden";
    return () => {
      openModals -= 1;
      if (openModals === 0) document.body.style.overflow = "";
    };
  }, []);

  // Rendered into <body> so a transformed or clipped ancestor (an animated
  // card, say) can't turn `fixed` into "fixed inside that card".
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
        className="absolute inset-0 backdrop-blur-sm"
        style={{
          background:
            "radial-gradient(48rem 26rem at 12% 0%, color-mix(in srgb, var(--color-aurora-a) 16%, transparent), transparent 70%), radial-gradient(44rem 24rem at 92% 100%, color-mix(in srgb, var(--color-aurora-c) 14%, transparent), transparent 70%), rgb(0 0 0 / 0.72)"
        }}
      />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        id={id}
        initial={{ opacity: 0, y: 14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.97 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className={`relative z-10 w-full ${maxWidth} shadow-2xl shadow-black/60`}
      >
        <div className="card-aurora flex max-h-[90vh] flex-col overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-teal-400/10 via-sky-400/[0.04] to-transparent"
          />
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 z-10 grid size-8 cursor-pointer place-items-center rounded-lg bg-tint text-mist-400 ring-1 ring-line transition-colors hover:text-strong hover:ring-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
            aria-label="Close dialog"
          >
            <X className="size-4" />
          </button>
          <div className="relative min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
