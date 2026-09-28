import { useMemo } from 'react';
import { CATEGORIES, categoryOf, isHouseChosen, resolveParties, typo, urgentProblems, type UrgentItem } from '@esli-chto/core';
import { haptic } from '../bridge';
import { useApp } from '../state';
import { Button } from '../ui/Button';
import { CategoryIcon, ElementIcon, Icon } from '../ui/icons';
import { Section, telHref } from '../ui/parts';
import { ServiceCard } from '../ui/ServiceCard';

/** Сводный список аварийных и срочных ситуаций с прямым звонком – без поиска объекта на схеме. */
export function UrgentView() {
  const { house, toast, open } = useApp();
  const items = useMemo(() => urgentProblems(house), [house]);
  const danger = items.filter((i) => i.problem.urgency === 'emergency');
  const urgent = items.filter((i) => i.problem.urgency === 'urgent');
  const byCategory = CATEGORIES.map((c) => ({ ...c, items: urgent.filter((i) => categoryOf(i.element.id) === c.id) })).filter((c) => c.items.length);
  const dispatch = resolveParties(house, ['dispatch'])[0]!;

  const onCall = (number: string) => {
    haptic.impact('heavy');
    toast(`Открываем набор номера ${number}`);
  };

  const row = (i: UrgentItem) => {
    const party = resolveParties(house, [i.call])[0];
    const phone = party?.contact?.phones[0];
    return (
      <li key={i.problem.id} className="urgent-row">
        {/* ситуация открывается поверх списка: «Назад» возвращает сюда, а не в карточку объекта */}
        <button type="button" className="urgent-row__open" onClick={() => open({ t: 'flow', problemId: i.problem.id, answers: [] })}>
          <span className="urgent-row__icon">
            <ElementIcon id={i.element.id} />
          </span>
          <span className="urgent-row__main">
            <span className="urgent-row__title">{typo(i.problem.title)}</span>
            <span className="urgent-row__sub">{i.element.title}</span>
          </span>
        </button>
        {phone && (
          <a
            className={i.problem.urgency === 'emergency' ? 'urgent-row__call is-critical' : 'urgent-row__call'}
            href={telHref(phone.number)}
            onClick={() => onCall(phone.number)}
            aria-label={`Позвонить ${phone.number} (${party?.contact?.name ?? party?.title}): ${i.problem.title}`}
          >
            <Icon name="call" size={20} />
            {/* в узкую кнопку помещается только короткий номер; полный – в карточке аварийной службы выше */}
            <span>{phone.number.replace(/\D/g, '').length <= 3 ? phone.number : i.call === 'dispatch' ? 'АДС' : 'Позвонить'}</span>
          </a>
        )}
      </li>
    );
  };

  return (
    <div className="urgent">
      <div className="alert-panel alert-panel--critical">
        <p className="alert-panel__label">
          <Icon name="danger" size={20} /> Опасно для жизни
        </p>
        <p className="alert-panel__title">Пожар, дым, обрушение, угроза жизни</p>
        <Button kind="critical" block href="tel:112" icon={<Icon name="call" />} onClick={() => onCall('112')}>
          Позвонить 112
        </Button>
        <p className="alert-panel__title">
          Запах газа – звоните <u>не из квартиры</u>
        </p>
        <Button kind="critical" block href="tel:104" icon={<Icon name="call" />} onClick={() => onCall('104')}>
          Позвонить 104
        </Button>
        <p className="alert-panel__note">
          Назовите <strong>адрес, подъезд и этаж</strong> – остальное спросит диспетчер.
        </p>
      </div>

      <Section title="Угроза жизни" hint="Нажмите на ситуацию – покажем, что делать до приезда помощи.">
        <ul className="urgent-list">{danger.map(row)}</ul>
      </Section>

      <Section title="Авария в доме" hint="Прорыв трубы, нет света, воды или тепла – звоните в аварийную службу дома.">
        <ServiceCard party={dispatch} house={house} primary onCall={onCall} onChooseHouse={() => open({ t: 'houses' })} />
        {byCategory.map((c) => (
          <div key={c.id} className="zone">
            <h4 className="zone__title">
              <CategoryIcon id={c.id} size={18} /> {c.title}
            </h4>
            <ul className="urgent-list">{c.items.map(row)}</ul>
          </div>
        ))}
      </Section>

      <p className="fineprint">
        {house.isDemo
          ? 'Кроме 112, 104 и 102, номера в этом доме демонстрационные.'
          : isHouseChosen(house)
            ? 'Если номер не отвечает, сверьтесь с квитанцией.'
            : 'Выберите свой дом – покажем телефон его аварийной службы.'}
      </p>
    </div>
  );
}
