import { useEffect, useRef, type ReactNode } from 'react';
import { IconButton } from '@maxhub/max-ui';
import { Icon } from './icons';

interface Props {
  title: string;
  /** Показывать ли кнопку «Назад» (шаг назад внутри шторки) */
  canBack: boolean;
  onBack: () => void;
  onClose: () => void;
  /** Меняется при смене содержимого – прокрутка возвращается наверх */
  contentKey: string;
  children: ReactNode;
}

/**
 * Единая шторка снизу для карточек объектов, ответа, обращения и служебных экранов (дизайн-код, раздел 26).
 * Фокус переносится в шторку при открытии; фон недоступен для клавиатуры и программ чтения с экрана.
 */
export function BottomSheet({ title, canBack, onBack, onClose, contentKey, children }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo?.({ top: 0 });
    bodyRef.current?.focus({ preventScroll: true });
  }, [contentKey]);

  return (
    <div className="sheet-root">
      <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet__grab" aria-hidden="true" />
        <header className="sheet__head">
          {canBack ? (
            <IconButton variant="ghost" size="medium" className="icon-btn" onClick={onBack} aria-label="Назад">
              <Icon name="back" />
            </IconButton>
          ) : (
            <span className="icon-btn-spacer" aria-hidden="true" />
          )}
          <h2 className="sheet__title">{title}</h2>
          <IconButton variant="ghost" size="medium" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <Icon name="close" />
          </IconButton>
        </header>
        <div className="sheet__body" ref={bodyRef} tabIndex={-1}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Модальное подтверждение поверх шторки (например, несохранённый черновик). */
export function ConfirmDialog({ title, text, confirm, cancel, onConfirm, onCancel }: { title: string; text: string; confirm: string; cancel: string; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="confirm-root" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-text">
      <div className="confirm-scrim" onClick={onCancel} aria-hidden="true" />
      <div className="confirm" ref={ref} tabIndex={-1}>
        <h2 className="confirm__title" id="confirm-title">{title}</h2>
        <p className="confirm__text" id="confirm-text">{text}</p>
        <div className="confirm__actions">
          <button type="button" className="confirm__btn" onClick={onCancel}>{cancel}</button>
          <button type="button" className="confirm__btn confirm__btn--danger" onClick={onConfirm}>{confirm}</button>
        </div>
      </div>
    </div>
  );
}
