import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { CheckCircle2, AlertCircle, Loader2, Info } from 'lucide-react';

export interface StatusProps {
  variant?: 'success' | 'danger' | 'loading' | 'info';
  children: React.ReactNode;
  className?: string;
}

export const Status: React.FC<StatusProps> = ({
  variant = 'info',
  children,
  className,
}) => {
  const icons = {
    success: <CheckCircle2 className="w-4 h-4 text-status-success shrink-0" />,
    danger: <AlertCircle className="w-4 h-4 text-status-danger shrink-0" />,
    loading: <Loader2 className="w-4 h-4 text-focus animate-spin shrink-0" />,
    info: <Info className="w-4 h-4 text-app-text-secondary shrink-0" />,
  };

  const textStyles = {
    success: 'text-status-success',
    danger: 'text-status-danger',
    loading: 'text-app-text',
    info: 'text-app-text-secondary',
  };

  return (
    <div className={twMerge(clsx('flex items-center gap-2 text-xs', textStyles[variant], className))}>
      {icons[variant]}
      <span>{children}</span>
    </div>
  );
};
