import React, { useEffect } from "react";
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        id={id}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className={`relative z-10 max-h-[90vh] w-full ${maxWidth} overflow-y-auto rounded-2xl bg-ink-900 p-6 shadow-2xl shadow-black/60 ring-1 ring-line-strong`}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 grid size-8 cursor-pointer place-items-center rounded-lg text-mist-500 transition-colors hover:bg-tint hover:text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
          aria-label="Close dialog"
        >
          <X className="size-4" />
        </button>
        {children}
      </motion.div>
    </div>
  );
}
