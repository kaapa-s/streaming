import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: ButtonVariant;
  children: ReactNode;
};

const variantClass: Record<ButtonVariant, string> = {
  default:
    'bg-surface-muted text-ink border border-border hover:bg-border/60',
  primary: 'bg-accent text-white hover:bg-accent-hover border border-transparent',
  danger: 'bg-danger text-white hover:bg-danger-hover border border-transparent',
  ghost: 'bg-transparent text-ink-muted hover:bg-surface-muted border border-transparent',
};

export function Button({
  loading = false,
  variant = 'default',
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'inline-flex items-center justify-center gap-2 font-semibold px-4 py-2.5 rounded-lg cursor-pointer transition-[filter,background-color] disabled:opacity-50 disabled:cursor-default',
    variantClass[variant],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="button-spinner" aria-hidden />}
      {children}
    </button>
  );
}
