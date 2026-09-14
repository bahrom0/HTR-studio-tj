'use client';

import { useEffect, useRef } from 'react';

type DialogProps = {
  open: boolean;
  title: string;
  description?: string;
  children: React.ReactNode;
  onClose: () => void;
};

export function Dialog({ open, title, description, children, onClose }: Readonly<DialogProps>) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog__surface">
        <h2 id="dialog-title">{title}</h2>
        {description ? <p>{description}</p> : null}
        <div className="dialog__actions">{children}</div>
      </div>
    </dialog>
  );
}
