"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function Dialog({ titleId, onClose, children }: { titleId: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[calc(100dvh-1rem)] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-3xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40 backdrop:backdrop-blur-sm min-[760px]:inset-0 min-[760px]:m-auto min-[760px]:max-h-[90dvh] min-[760px]:max-w-lg min-[760px]:rounded-3xl"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          onClose();
        }
      }}
    >
      {children}
    </dialog>
  );
}
