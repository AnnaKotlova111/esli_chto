import type { ReactNode } from 'react';
import { typo, type Basis, type Certainty, type Urgency } from '@esli-chto/core';
import { Icon, type UiIconName } from './icons';

export type Tone = 'info' | 'warning' | 'critical' | 'success' | 'neutral';

const TONE_ICON: Record<Tone, UiIconName> = {
  info: 'info',
  warning: 'warning',
  critical: 'danger',
  success: 'success',
  neutral: 'notice',
};

/** Информационный блок. Смысл передаётся текстом и иконкой, цвет лишь подкрепляет его. */
export function Callout({ tone = 'info', title, icon, children, role }: { tone?: Tone; title?: string; icon?: UiIconName; children?: ReactNode; role?: 'alert' | 'note' }) {
  return (
    <div className={`callout callout--${tone}`} role={role}>
      <span className="callout__icon">
        <Icon name={icon ?? TONE_ICON[tone]} size={20} />
      </span>
      <div className="callout__body">
        {title && <p className="callout__title">{typo(title)}</p>}
        {children && <div className="callout__text">{children}</div>}
      </div>
    </div>
  );
}

export function Badge({ tone, icon, children }: { tone: Tone; icon?: UiIconName; children: ReactNode }) {
  return (
    <span className={`badge badge--${tone}`}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}

export function UrgencyBadge({ urgency }: { urgency?: Urgency }) {
  if (urgency === 'emergency') return <Badge tone="critical" icon="danger">Опасно</Badge>;
  if (urgency === 'urgent') return <Badge tone="warning" icon="warning">Срочно</Badge>;
  return null;
}

export const CERTAINTY_LABEL: Record<Certainty, string> = { clear: 'Ответ однозначный', disputed: 'Спорный случай' };

export function CertaintyBadge({ certainty }: { certainty: Certainty }) {
  return certainty === 'clear' ? (
    <Badge tone="success" icon="success">{CERTAINTY_LABEL.clear}</Badge>
  ) : (
    <Badge tone="warning" icon="warning">{CERTAINTY_LABEL.disputed}</Badge>
  );
}

export const BASIS_LABEL: Record<Basis, string> = {
  norm: 'По норме закона',
  practice: 'По сложившейся практике',
  contract: 'Зависит от договора',
};

export const BASIS_HINT: Record<Basis, string> = {
  norm: 'Вывод прямо следует из нормы права – ссылки ниже.',
  practice: 'Прямой нормы на этот случай нет или она не однозначна: вывод основан на сложившейся практике.',
  contract: 'Единого правила нет: ответ зависит от договора управления или решения собственников дома.',
};

export function BasisBadge({ basis }: { basis: Basis }) {
  return <Badge tone="neutral" icon="legal">{BASIS_LABEL[basis]}</Badge>;
}

export function Section({ title, hint, id, children }: { title: string; hint?: string; id?: string; children: ReactNode }) {
  return (
    <section className="section" id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      <h3 className="section__title" id={id ? `${id}-title` : undefined}>
        {title}
      </h3>
      {hint && <p className="section__hint">{typo(hint)}</p>}
      {children}
    </section>
  );
}

/** Переключатель схем: группа вкладок с управлением стрелками. */
export function Segmented<T extends string>({ items, value, onChange, label }: { items: { id: T; label: string }[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {items.map((it, i) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={it.id === value}
          tabIndex={it.id === value ? 0 : -1}
          className={it.id === value ? 'segmented__item is-active' : 'segmented__item'}
          onClick={() => onChange(it.id)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            e.preventDefault();
            const next = items[(i + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length]!;
            onChange(next.id);
            (e.currentTarget.parentElement?.children[items.indexOf(next)] as HTMLElement | undefined)?.focus();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Строка списка: иконка, заголовок, подпись, метка справа и стрелка. */
export function ListRow({ icon, title, subtitle, badge, onClick, disabled, trailing }: { icon?: ReactNode; title: ReactNode; subtitle?: ReactNode; badge?: ReactNode; onClick?: () => void; disabled?: boolean; trailing?: ReactNode }) {
  return (
    <button type="button" className="list-row" onClick={onClick} disabled={disabled}>
      {icon && <span className="list-row__icon">{icon}</span>}
      <span className="list-row__main">
        <span className="list-row__title">{typeof title === 'string' ? typo(title) : title}</span>
        {subtitle && <span className="list-row__subtitle">{typeof subtitle === 'string' ? typo(subtitle) : subtitle}</span>}
      </span>
      {badge}
      {trailing ?? <Icon name="forward" size={20} className="list-row__chev" />}
    </button>
  );
}

export function Chip({ active, onClick, children, icon }: { active?: boolean; onClick: () => void; children: ReactNode; icon?: ReactNode }) {
  return (
    <button type="button" className={active ? 'chip is-active' : 'chip'} aria-pressed={active} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}

/** Ссылка tel: – только цифры и плюс. */
export const telHref = (num: string) => `tel:${num.replace(/[^\d+]/g, '')}`;

/** Телефоны по одному на строку: подпись слева, номер справа и никогда не разрывается. */
export function PhoneLines({ phones }: { phones: { number: string; label?: string }[] }) {
  return (
    <ul className="phone-lines">
      {phones.map((p) => (
        <li key={`${p.label}-${p.number}`} className="phone-line">
          {p.label && <span className="phone-line__label">{p.label}</span>}
          <a className="phone-line__num" href={telHref(p.number)}>
            {p.number}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Форма слова для числа – общая с ботом, из ядра. */
export { plural } from '@esli-chto/core';
