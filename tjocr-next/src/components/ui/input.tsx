import React, { forwardRef } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="flex flex-col gap-1 w-full">
        {label && (
          <label htmlFor={inputId} className="text-xs font-medium text-app-text-secondary">
            {label}
          </label>
        )}
        <input
          id={inputId}
          ref={ref}
          className={twMerge(
            clsx(
              'h-10 min-h-[40px] px-3 bg-surface border border-border rounded-input text-sm text-app-text transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent',
              'placeholder:text-app-text-secondary disabled:opacity-50 disabled:cursor-not-allowed',
              error && 'border-status-danger focus:ring-status-danger',
              className
            )
          )}
          {...props}
        />
        {error && <span className="text-xs text-status-danger">{error}</span>}
      </div>
    );
  }
);

Input.displayName = 'Input';
