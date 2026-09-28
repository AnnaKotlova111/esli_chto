import { needsHouseChoice, typo, type HouseProfile, type PartyId, type ResolvedParty } from '@esli-chto/core';
import { Fragment } from 'react';
import { openLink } from '../bridge';
import { Button } from './Button';
import { Rich } from './Rich';
import { Icon, PartyIcon } from './icons';
import { PhoneLines, telHref } from './parts';

const TYPE: Record<PartyId, string> = {
  manager: 'Управляющая организация',
  dispatch: 'Аварийная служба дома',
  owner: 'Ваша зона ответственности',
  neighbor: 'Собственник соседней квартиры',
  water_utility: 'Водоснабжение',
  heat_utility: 'Отопление и горячая вода',
  energy_utility: 'Электроэнергия',
  gas_service: 'Газ: обслуживание и начисления',
  gas_emergency: 'Экстренная служба',
  tko_operator: 'Вывоз мусора',
  lift_service: 'Лифт',
  intercom_service: 'Домофон',
  municipality: 'Администрация города',
  housing_inspection: 'Жалобы на управляющую организацию',
  police: 'Экстренная служба',
  telecom: 'Оператор связи',
  emergency112: 'Экстренная служба',
};

export const partyType = (id: PartyId, house: HouseProfile): string =>
  id === 'manager' ? (house.managerKind === 'УК' ? 'Управляющая организация' : `Форма управления: ${house.managerKind}`) : TYPE[id];

const EMERGENCY = new Set<PartyId>(['emergency112', 'gas_emergency', 'police']);

interface Props {
  party: ResolvedParty;
  house: HouseProfile;
  /** Основной ответственный – выделяется рамкой */
  primary?: boolean;
  /** Показать ссылку «Почему сюда?» и куда она ведёт */
  onWhy?: () => void;
  /** Вызывается при нажатии «Позвонить» – для обратной связи и тактильного отклика */
  onCall?: (number: string) => void;
  /** Открыть выбор дома – для управляющей организации, пока дом не выбран */
  onChooseHouse?: () => void;
}

/** Карточка организации или службы: кто, тип, зона ответственности, режим работы, «Позвонить». */
export function ServiceCard({ party, house, primary, onWhy, onCall, onChooseHouse }: Props) {
  const c = party.contact;
  const [main, ...more] = c?.phones ?? [];
  const critical = EMERGENCY.has(party.id);
  const name = party.id === 'owner' || party.id === 'neighbor' ? party.title : (c?.name ?? party.title);
  const isShort = (n: string) => n.replace(/\D/g, '').length <= 3;
  const shortNumber = main && isShort(main.number);
  // короткие экстренные номера – отдельными кнопками, обычные – строками под «Позвонить»
  const moreShort = more.filter((p) => isShort(p.number));
  const moreLong = more.filter((p) => !isShort(p.number));
  const askHouse = needsHouseChoice(house, party);

  return (
    <article className={['service-card', primary ? 'is-primary' : '', critical ? 'is-critical' : ''].join(' ').trim()}>
      <header className="service-card__head">
        <span className="service-card__icon">
          <PartyIcon icon={party.icon} />
        </span>
        <div className="service-card__names">
          <h4 className="service-card__name">{typo(name)}</h4>
          <p className="service-card__type">{partyType(party.id, house)}</p>
        </div>
      </header>

      <p className="service-card__role">{typo(party.role)}</p>

      {(c?.hours || c?.address || c?.site || c?.email) && (
        <ul className="service-card__meta">
          {c?.hours && (
            <li>
              <Icon name="hours" size={16} /> {typo(c.hours)}
            </li>
          )}
          {c?.address && (
            <li>
              <Icon name="location" size={16} /> {typo(c.address)}
            </li>
          )}
          {c?.email && (
            <li>
              <Icon name="email" size={16} /> {c.email}
            </li>
          )}
          {c?.site && (
            <li>
              <Icon name="site" size={16} />{' '}
              {/* сайт открывается по нажатию: в MAX – через Bridge, вне MAX – новой вкладкой */}
              <a
                className="service-card__link"
                href={`https://${c.site}`}
                onClick={(e) => {
                  e.preventDefault();
                  openLink(`https://${c.site}`);
                }}
              >
                {c.site}
              </a>
            </li>
          )}
        </ul>
      )}

      {askHouse ? (
        <div className="service-card__missing">
          <Icon name="location" size={16} />
          <span>Выберите свой дом – покажем телефоны его управляющей организации и аварийной службы.</span>
        </div>
      ) : party.missingContact ? (
        <div className="service-card__missing">
          <Icon name="notice" size={16} />
          <span>Телефона нет в справочнике. Посмотрите его в квитанции или на доске объявлений в подъезде.</span>
        </div>
      ) : null}
      {askHouse && onChooseHouse && (
        <Button kind="secondary" block icon={<Icon name="location" />} onClick={onChooseHouse}>
          Выбрать дом
        </Button>
      )}
      {c?.note && (
        <p className="service-card__note">
          <Rich text={c.note} />
        </p>
      )}

      {(main || onWhy) && (
        <div className="service-card__actions">
          {main && (
            <>
              <Button
                kind={critical ? 'critical' : 'primary'}
                block
                href={telHref(main.number)}
                icon={<Icon name="call" />}
                onClick={() => onCall?.(main.number)}
              >
                {shortNumber ? `Позвонить ${main.number}` : 'Позвонить'}
              </Button>
              {(!shortNumber || moreLong.length > 0) && <PhoneLines phones={shortNumber ? moreLong : [main, ...moreLong]} />}
            </>
          )}
          {moreShort.map((p) => (
            <Fragment key={p.number}>
              <Button kind="secondary" block href={telHref(p.number)} icon={<Icon name="call" />} onClick={() => onCall?.(p.number)}>
                {`Позвонить ${p.number}`}
              </Button>
              <p className="service-card__phone">{p.label}</p>
            </Fragment>
          ))}
          {onWhy && (
            <button type="button" className="link-btn" onClick={onWhy}>
              <Icon name="help" size={18} /> Почему сюда?
            </button>
          )}
        </div>
      )}
    </article>
  );
}
