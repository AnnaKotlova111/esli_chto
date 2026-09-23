import { useMemo, useState } from 'react';
import { ALL_FEATURES, CITY, HOUSES, organizationOf, searchHouses, type Feature, type HouseProfile } from '@esli-chto/core';
import { Input } from '@maxhub/max-ui';
import { haptic } from '../bridge';
import { useApp } from '../state';
import { Button } from '../ui/Button';
import { Icon } from '../ui/icons';
import { Callout, Chip, ListRow, Section, plural } from '../ui/parts';

export const FEATURE_LABEL: Record<Feature, string> = {
  elevator: 'Лифт',
  garbage_chute: 'Мусоропровод',
  gas: 'Газ',
  central_heating: 'Центральное отопление',
  intercom: 'Домофон',
  basement: 'Подвал',
};

const EXAMPLES = ['Коровина 11', 'Ленинградская', '50 лет Октября', 'Каменка'];

/** Выбор дома по адресу из справочника города и отметки о том, что в доме есть. */
export function HousesView() {
  const { house, setHouse, closeAll, toast } = useApp();
  const [q, setQ] = useState('');
  const hits = useMemo(() => searchHouses(q, 30), [q]);
  const chosen = house.id !== 'none';

  const pick = (h: HouseProfile) => {
    setHouse(h.id);
    setQ('');
    haptic.notify('success');
    toast(`Ваш дом: ${h.title}`);
  };

  return (
    <div className="houses">
      {chosen && (
        <>
          <HouseCard house={house} />
          <FeaturesEditor />
          <Button kind="primary" block icon={<Icon name="success" />} onClick={closeAll}>
            Готово
          </Button>
        </>
      )}

      <Section
        title={chosen ? 'Другой дом' : 'Найдите свой дом'}
        hint={`В справочнике ${HOUSES.length} ${plural(HOUSES.length, 'дом', 'дома', 'домов')}: ${Object.values(CITY.settlements).join(', ')}. Введите улицу и номер дома.`}
      >
        <form className="houses__search" role="search" onSubmit={(e) => (e.preventDefault(), hits[0] && pick(hits[0]))}>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Например: Коровина 11"
            aria-label="Адрес дома: улица и номер"
            iconBefore={<Icon name="location" size={20} />}
            withClearButton
            enterKeyHint="search"
            autoComplete="off"
          />
        </form>
        {q.trim() === '' ? (
          <div className="chips">
            {EXAMPLES.map((s) => (
              <Chip key={s} onClick={() => setQ(s)}>
                {s}
              </Chip>
            ))}
          </div>
        ) : hits.length === 0 ? (
          <p className="text-secondary">
            Такого адреса нет в справочнике. Проверьте написание или выберите ближайший вариант по улице – например, «Ленинградская».
          </p>
        ) : (
          <div className="card-list" role="listbox" aria-label="Найденные дома">
            {hits.map((h) => (
              <ListRow
                key={h.id}
                icon={<Icon name="location" />}
                title={h.title}
                subtitle={organizationOf(h.id)?.short}
                onClick={() => pick(h)}
                trailing={h.id === house.id ? <Icon name="success" size={20} className="list-row__chev" /> : undefined}
              />
            ))}
          </div>
        )}
      </Section>

      <p className="fineprint">
        Источник: {CITY.source}. Сведения на {CITY.updatedAt.split('-').reverse().join('.')}. Если данные о вашем доме устарели, ориентируйтесь на квитанцию.
      </p>
    </div>
  );
}

/** Карточка выбранного дома: адрес, форма управления и организация из справочника. */
export function HouseCard({ house }: { house: HouseProfile }) {
  const org = organizationOf(house.id);
  const m = house.contacts.manager;
  return (
    <div className="house-card">
      <p className="house-card__label">Ваш дом</p>
      <p className="house-card__address">{house.address}</p>
      <p className="house-card__org">
        {org?.kind === 'УК' ? 'Управляющая организация' : `Форма управления: ${house.managerKind}`} – {m?.name}
      </p>
      {m?.phones[0] && (
        <p className="text-secondary">
          {m.phones.map((p) => p.number).join(', ')}
          {house.contacts.dispatch ? ` · диспетчерская ${house.contacts.dispatch.phones[0]?.number}` : ''}
        </p>
      )}
      {m?.note && <Callout tone="warning">{m.note}</Callout>}
    </div>
  );
}

/** Отметки «что есть в доме»: в реестре этого нет, поэтому по умолчанию показываем все объекты. */
export function FeaturesEditor() {
  const { house, setFeatures } = useApp();
  const toggle = (f: Feature) => {
    haptic.selection();
    const next = house.features.includes(f) ? house.features.filter((x) => x !== f) : [...house.features, f];
    setFeatures(house.id, ALL_FEATURES.filter((x) => next.includes(x)));
  };
  return (
    <Section
      title="Что есть в доме"
      hint={
        house.featuresKnown
          ? 'Объекты, которых нет, приглушены на схемах с пометкой «нет в доме». Отметки хранятся только на этом устройстве.'
          : 'В справочнике этого нет. Снимите отметки с того, чего в доме нет, – лишнее приглушим на схемах.'
      }
    >
      <div className="chips chips--wrap" role="group" aria-label="Что есть в доме">
        {ALL_FEATURES.map((f) => (
          <Chip key={f} active={house.features.includes(f)} onClick={() => toggle(f)} icon={<Icon name={house.features.includes(f) ? 'success' : 'close'} size={16} />}>
            {FEATURE_LABEL[f]}
          </Chip>
        ))}
      </div>
    </Section>
  );
}
