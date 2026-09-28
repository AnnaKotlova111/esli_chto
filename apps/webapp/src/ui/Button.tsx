import type { MouseEvent, ReactNode } from 'react';
import { Button as MaxButton, type ButtonVariant } from '@maxhub/max-ui';

export type ButtonKind = 'primary' | 'critical' | 'secondary' | 'ghost';

interface Props {
  kind?: ButtonKind;
  /** Растянуть на всю ширину контейнера */
  block?: boolean;
  /** Ссылка вместо действия – например, tel: для кнопки «Позвонить» */
  href?: string;
  icon?: ReactNode;
  iconAfter?: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  className?: string;
  children: ReactNode;
  'aria-label'?: string;
}

const VARIANT: Record<ButtonKind, ButtonVariant> = {
  primary: 'primary',
  critical: 'destructive',
  secondary: 'secondary',
  ghost: 'ghost',
};

/**
 * Единая кнопка для всех действий: кнопка UI-кита MAX
 * с высотой 52 px и цветами из токенов. Одинаковое действие – всегда одинаковое слово.
 */
export function Button({ kind = 'primary', block, href, icon, iconAfter, disabled, loading, onClick, className, children, ...aria }: Props) {
  const cls = ['btn', `btn--${kind}`, block ? 'btn--block' : '', className ?? ''].filter(Boolean).join(' ');
  const common = {
    variant: VARIANT[kind],
    size: 'large' as const,
    stretched: block,
    className: cls,
    iconBefore: icon,
    iconAfter,
    disabled,
    loading,
    ...aria,
  };
  if (href && !disabled) {
    return (
      <MaxButton asChild {...common}>
        <a href={href} onClick={onClick}>
          {children}
        </a>
      </MaxButton>
    );
  }
  return (
    <MaxButton type="button" {...common} onClick={onClick}>
      {children}
    </MaxButton>
  );
}
