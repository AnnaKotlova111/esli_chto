import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { IconButton } from '@maxhub/max-ui';
import { useSwipeGestures } from './gestures';
import { Icon } from './icons';

/** Откуда въезжает новый экран: вперёд – справа, назад – слева, замена – плавное появление. */
export type PageDirection = 'forward' | 'back' | 'none';

interface Props {
  title: string;
  /** Показывать ли кнопку «Назад» (шаг назад внутри шторки) */
  canBack: boolean;
  onBack: () => void;
  onClose: () => void;
  /** Меняется при смене содержимого – прокрутка возвращается наверх */
  contentKey: string;
  direction: PageDirection;
  /** Шторка уезжает вниз после закрытия; по окончании вызывается onLeft */
  leaving?: boolean;
  onLeft?: () => void;
  children: ReactNode;
}

/**
 * Единая шторка снизу для карточек объектов, ответа, обращения и служебных экранов (дизайн-код, раздел 26).
 * Фокус переносится в шторку при открытии; фон недоступен для клавиатуры и программ чтения с экрана.
 * Жесты: свайп вправо – шаг назад (с первого экрана – закрыть), потянуть за шапку вниз – закрыть.
 */
export function BottomSheet({ title, canBack, onBack, onClose, contentKey, direction, leaving, onLeft, children }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);

  // Где человек был на каждом экране: при возврате «назад» возвращаем на то же место, новый экран – с начала
  const scrollOf = useRef(new Map<string, number>());
  const keyRef = useRef(contentKey);
  keyRef.current = contentKey;

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const saved = direction === 'back' ? scrollOf.current.get(contentKey) : undefined;
    body.scrollTop = saved ?? 0;
    body.focus({ preventScroll: true });
    // направление берём на момент смены экрана, поэтому в зависимостях только contentKey
  }, [contentKey]);

  // запасной таймер: если анимация закрытия не сработала, шторка всё равно исчезнет
  useEffect(() => {
    if (!leaving || !onLeft) return;
    const t = window.setTimeout(onLeft, 300);
    return () => window.clearTimeout(t);
  }, [leaving, onLeft]);

  useSwipeGestures({
    root: sheetRef,
    rightTarget: () => (canBack ? pageRef.current : sheetRef.current),
    onRight: canBack ? onBack : onClose,
    downHandle: headRef,
    downTarget: () => sheetRef.current,
    onDown: onClose,
  });

  return (
    <div className={leaving ? 'sheet-root is-leaving' : 'sheet-root'} aria-hidden={leaving || undefined}>
      <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={sheetRef}>
        <div className="sheet__handle" ref={headRef}>
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
        </div>
        <div className="sheet__body" ref={bodyRef} tabIndex={-1} onScroll={(e) => scrollOf.current.set(keyRef.current, e.currentTarget.scrollTop)}>
          <div key={contentKey} ref={pageRef} className={`sheet__page is-${direction}`}>
            {children}
          </div>
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
