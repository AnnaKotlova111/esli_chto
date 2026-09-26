import { useEffect, useMemo, useRef, useState } from 'react';
import { getProblem, search } from '@esli-chto/core';
import { IconButton, Input } from '@maxhub/max-ui';
import { useApp } from '../state';
import { useSwipeGestures } from '../ui/gestures';
import { ElementIcon, Icon } from '../ui/icons';
import { Chip, ListRow, UrgencyBadge } from '../ui/parts';

const EXAMPLES = ['течёт кран', 'не горит лампочка', 'нет горячей воды', 'застрял в лифте', 'холодная батарея', 'засор'];

/** Поиск свободным текстом: тот же движок, что у бота, – одинаковый запрос даёт одинаковый ответ. */
export function SearchOverlay() {
  const { state, house, setSearch, goToElement, open, rememberSearch } = useApp();
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // свайп вправо закрывает поиск – как «назад» в iOS
  useSwipeGestures({ root: rootRef, rightTarget: () => rootRef.current, onRight: () => setSearch(false), active: state.searchOpen });

  useEffect(() => {
    if (state.searchOpen) {
      setQ('');
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [state.searchOpen]);

  const hits = useMemo(() => {
    const seen = new Set<string>();
    return search(q, house, 20).filter((h) => {
      const key = h.problemId ?? `e:${h.elementId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [q, house]);

  if (!state.searchOpen) return null;

  // Ситуация открывается сразу, поверх поиска: «Назад» возвращает к результатам, а не в карточку объекта
  const pick = (elementId: string, problemId?: string) => {
    rememberSearch(q);
    if (problemId) open({ t: 'flow', problemId, answers: [] });
    else goToElement(elementId);
  };
  const problems = hits.filter((h) => h.problemId).slice(0, 8);
  const elements = hits.filter((h) => !h.problemId).slice(0, 5);
  const recent = state.recent.map((id) => getProblem(id)).filter((x): x is NonNullable<typeof x> => Boolean(x)).slice(0, 4);

  return (
    <div className="search" ref={rootRef} role="dialog" aria-modal="true" aria-label="Поиск: что случилось">
      <div className="search__bar">
        <IconButton variant="ghost" size="medium" className="icon-btn" onClick={() => setSearch(false)} aria-label="Закрыть поиск">
          <Icon name="back" />
        </IconButton>
        <form
          className="search__form"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const first = hits[0];
            if (first) pick(first.elementId, first.problemId);
          }}
        >
          <Input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Что случилось? Например: течёт кран"
            aria-label="Опишите, что случилось"
            iconBefore={<Icon name="search" size={20} />}
            withClearButton
            enterKeyHint="search"
            autoComplete="off"
          />
        </form>
      </div>

      <div className="search__body">
        {q.trim() === '' ? (
          <>
            {state.searches.length > 0 && (
              <section className="block">
                <h2 className="block__title">Вы искали</h2>
                <div className="chips">
                  {state.searches.map((s) => (
                    <Chip key={s} onClick={() => setQ(s)} icon={<Icon name="hours" size={16} />}>
                      {s}
                    </Chip>
                  ))}
                </div>
              </section>
            )}
            {recent.length > 0 && (
              <section className="block">
                <h2 className="block__title">Недавно открытые</h2>
                <div className="card-list">
                  {recent.map(({ element, problem }) => (
                    <ListRow key={problem.id} icon={<ElementIcon id={element.id} />} title={problem.title} subtitle={element.title} onClick={() => open({ t: 'flow', problemId: problem.id, answers: [] })} />
                  ))}
                </div>
              </section>
            )}
            <section className="block">
              <h2 className="block__title">Например</h2>
              <div className="chips">
                {EXAMPLES.map((s) => (
                  <Chip key={s} onClick={() => setQ(s)}>
                    {s}
                  </Chip>
                ))}
              </div>
            </section>
          </>
        ) : hits.length === 0 ? (
          <div className="empty" role="status">
            <Icon name="search" size={32} />
            <p className="empty__title">Ничего не нашли</p>
            <p className="text-secondary">Попробуйте другими словами: «течёт», «не горит», «засор», «нет воды», «лифт» – или найдите предмет на схеме.</p>
          </div>
        ) : (
          <>
            {problems.length > 0 && (
              <section className="block" aria-live="polite">
                <h2 className="block__title">Ситуации</h2>
                <div className="card-list">
                  {problems.map((h) => (
                    <ListRow
                      key={h.problemId}
                      icon={<ElementIcon id={h.elementId} />}
                      title={h.title}
                      subtitle={h.path}
                      badge={<UrgencyBadge urgency={getProblem(h.problemId!)?.problem.urgency} />}
                      onClick={() => pick(h.elementId, h.problemId)}
                    />
                  ))}
                </div>
              </section>
            )}
            {elements.length > 0 && (
              <section className="block">
                <h2 className="block__title">Объекты</h2>
                <div className="card-list">
                  {elements.map((h) => (
                    <ListRow key={h.elementId} icon={<ElementIcon id={h.elementId} />} title={h.title} subtitle={h.scope === 'house' ? `Наш дом · ${h.path}` : `Моя квартира · ${h.path}`} onClick={() => pick(h.elementId)} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
