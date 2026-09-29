import { useMemo } from 'react';
import {
  ALL_ELEMENTS, CATEGORIES, categoryOf, getProblem, isElementAvailable, zoneTitle, type HouseElement,
} from '@esli-chto/core';
import { getScene, scenesFor } from '../scenes/scenes';
import { useApp, type Tab } from '../state';
import { CategoryIcon, ElementIcon, Icon } from '../ui/icons';
import { Chip, ListRow, Segmented, UrgencyBadge, plural } from '../ui/parts';
import { SceneView } from './SceneView';

/** Самые частые ситуации – быстрый доступ без поиска и схемы. */
const FREQUENT: Record<Tab, string[]> = {
  house: ['lamp_entrance__burned', 'elevator__stuck', 'trash_area__overflow', 'roof__leak', 'risers__no_hot', 'yard__snow'],
  flat: ['pipes_valves__leak', 'ceiling__leak', 'radiator__cold', 'gas_stove__smell', 'flat_shield__no_power', 'sewer__clog'],
};

const ZONES: Record<Tab, string[]> = {
  house: ['outside', 'entrance', 'technical'],
  flat: ['hall', 'kitchen', 'bath', 'room', 'balcony'],
};

export function HowItWorks() {
  return (
    <details className="how">
      <summary>
        <Icon name="help" size={20} />
        <span>Как это работает</span>
        <Icon name="expand" size={20} className="how__chev" />
      </summary>
      <ol className="how__steps">
        <li>Нажмите на подпись предмета на картинке или опишите проблему в поиске.</li>
        <li>Выберите, что случилось, и при необходимости ответьте на 1-2 вопроса.</li>
        <li>Узнайте, кто отвечает, позвоните и следуйте шагам. Для спорных случаев есть готовое обращение.</li>
      </ol>
    </details>
  );
}

export function TabContent({ tab }: { tab: Tab }) {
  const { house, state, setScene, setCategory, goToElement, open } = useApp();
  const scenes = scenesFor(tab);
  const scene = getScene(state.scene[tab]) ?? scenes[0]!;
  const category = state.category[tab];

  const elements = useMemo(() => ALL_ELEMENTS.filter((e) => e.scope === tab), [tab]);
  const categories = useMemo(() => CATEGORIES.filter((c) => elements.some((e) => categoryOf(e.id) === c.id)), [elements]);
  const groups = useMemo(() => {
    const shown = elements.filter((e) => !category || categoryOf(e.id) === category);
    const byZone = new Map<string, HouseElement[]>();
    for (const e of shown) byZone.set(e.zone, [...(byZone.get(e.zone) ?? []), e]);
    return ZONES[tab].filter((z) => byZone.has(z)).map((z) => ({ zone: z, items: byZone.get(z)! }));
  }, [elements, category, tab]);

  const frequent = FREQUENT[tab]
    .map((id) => getProblem(id))
    .filter((f): f is NonNullable<typeof f> => Boolean(f && isElementAvailable(house, f.element)));

  return (
    <div className="tab-content">
      {scenes.length > 1 && (
        <Segmented
          label="Схема"
          items={scenes.map((s) => ({ id: s.id, label: s.short }))}
          value={scene.id}
          onChange={(id) => setScene(tab, id)}
        />
      )}

      <SceneView scene={scene} key={scene.id} />

      <section className="block" aria-labelledby={`frequent-${tab}`}>
        <h2 className="block__title" id={`frequent-${tab}`}>Частые ситуации</h2>
        <div className="card-list">
          {frequent.map(({ element, problem }) => (
            <ListRow
              key={problem.id}
              icon={<ElementIcon id={element.id} />}
              title={problem.title}
              subtitle={element.title}
              badge={<UrgencyBadge urgency={problem.urgency} />}
              onClick={() => open({ t: 'flow', problemId: problem.id, answers: [] })}
            />
          ))}
        </div>
      </section>

      <section className="block" aria-labelledby={`all-${tab}`}>
        <h2 className="block__title" id={`all-${tab}`}>Все объекты</h2>
        <p className="block__hint">Тот же список, что на схеме, – если удобнее читать, чем искать на картинке.</p>
        <div className="chips" role="group" aria-label="Категория">
          <Chip active={!category} onClick={() => setCategory(tab, null)}>
            Все
          </Chip>
          {categories.map((c) => (
            <Chip key={c.id} active={category === c.id} onClick={() => setCategory(tab, category === c.id ? null : c.id)} icon={<CategoryIcon id={c.id} size={16} />}>
              {c.title}
            </Chip>
          ))}
        </div>
        {groups.map((g) => (
          <div key={g.zone} className="zone">
            <h3 className="zone__title">{zoneTitle(g.zone)}</h3>
            <div className="card-list">
              {g.items.map((e) => {
                const available = isElementAvailable(house, e);
                return (
                  <ListRow
                    key={e.id}
                    icon={<ElementIcon id={e.id} />}
                    title={e.title}
                    subtitle={available ? `${e.problems.length} ${plural(e.problems.length, 'ситуация', 'ситуации', 'ситуаций')}` : 'Нет в этом доме'}
                    disabled={!available}
                    onClick={() => goToElement(e.id)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
