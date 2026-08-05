import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'default' | 'primary' | 'danger';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: ButtonVariant;
  children: ReactNode;
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
  const classes = [variant !== 'default' ? variant : undefined, className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={classes || undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="button-spinner" aria-hidden />}
      {children}
    </button>
  );
}
