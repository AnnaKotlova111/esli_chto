import { useEffect, useMemo } from 'react';
import {
  emergencyPartyOf, getNorm, localizeOutcome, resolveParties,
  type HouseElement, type Outcome, type Problem,
} from '@esli-chto/core';
import { haptic, shareText } from '../bridge';
import { useApp } from '../state';
import { Button } from '../ui/Button';
import { Icon } from '../ui/icons';
import { BASIS_HINT, BasisBadge, Callout, CertaintyBadge, Section, telHref } from '../ui/parts';
import { Rich } from '../ui/Rich';
import { ServiceCard } from '../ui/ServiceCard';

interface Props {
  element: HouseElement;
  problem: Problem;
  outcome: Outcome;
  answers: number[];
}

/** Экран ответа: срочное действие → кто отвечает и куда звонить → почему → что делать → на чём основано. */
export function ResultView({ element, problem, outcome: raw, answers }: Props) {
  const { house, open, toast, touchRecent } = useApp();
  const outcome = useMemo(() => localizeOutcome(raw, house), [raw, house]);
  const parties = useMemo(() => resolveParties(house, outcome.responsible), [house, outcome]);
  const emergency = problem.urgency === 'emergency';
  const urgent = problem.urgency === 'urgent';

  // Кому звонить сразу: экстренная служба при угрозе жизни, при аварии – диспетчерская
  const callParty = useMemo(() => {
    const e = emergencyPartyOf(outcome);
    if (emergency && e) return resolveParties(house, [e])[0];
    // при аварии сначала аварийно-диспетчерская служба, затем первая сторона с телефоном
    if (urgent) return parties.find((p) => p.id === 'dispatch' && p.contact?.phones.length) ?? parties.find((p) => p.contact?.phones.length);
    return undefined;
  }, [emergency, urgent, outcome, house, parties]);
  const callPhone = callParty?.contact?.phones[0];

  useEffect(() => {
    touchRecent(problem.id);
    haptic.notify(emergency ? 'warning' : 'success');
  }, [problem.id, emergency, touchRecent]);

  const onCall = (number: string) => {
    haptic.impact(emergency ? 'heavy' : 'medium');
    toast(`Открываем набор номера ${number}`);
  };

  const scrollToWhy = () => document.getElementById('why')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const share = async () => {
    const main = parties[0];
    const phone = main?.contact?.phones[0];
    const text = [
      `${element.title}: ${problem.title}`,
      outcome.headline,
      main && main.id !== 'owner' ? `Куда: ${main.contact?.name ?? main.title}${phone ? `, ${phone.number}` : ''}` : '',
      '',
      'Что делать:',
      ...outcome.steps.map((s, i) => `${i + 1}. ${s}`),
      '',
      `Адрес: ${house.address}`,
      house.isDemo ? 'Демо-данные: организации и телефоны вымышлены.' : 'Контакты – из открытых данных, сверяйте с квитанцией.',
      'Справка из мини-приложения «Если что» в MAX.',
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
    const r = await shareText(text.join('\n'));
    toast(r === 'copied' ? 'Текст скопирован – вставьте его в чат' : r === 'shared' ? 'Готово: ответ отправлен' : 'Не получилось поделиться');
  };

  const steps = (
    <Section title="Что делать">
      <ol className="steps">
        {outcome.steps.map((s, i) => (
          <li key={i} className="steps__item">
            <span className="steps__num" aria-hidden="true">{i + 1}</span>
            <span className="steps__text">
              <Rich text={s} />
            </span>
          </li>
        ))}
      </ol>
    </Section>
  );

  const primary = parties[0];
  const others = parties.slice(1).filter((p) => !(callParty && p.id === callParty.id && emergency));
  const escalate = outcome.responsible.includes('manager') && !emergency;

  return (
    <div className="result">
      {emergency && callPhone && (
        <div className="alert-panel alert-panel--critical" role="alert">
          <p className="alert-panel__label">
            <Icon name="danger" size={20} /> Опасно
          </p>
          <p className="alert-panel__title">
            Сначала безопасность: звоните <strong>{callPhone.number}</strong>
          </p>
          <Button kind="critical" block href={telHref(callPhone.number)} icon={<Icon name="call" />} onClick={() => onCall(callPhone.number)}>
            {`Позвонить ${callPhone.number}`}
          </Button>
          {callParty?.contact?.note && (
            <p className="alert-panel__note">
              <Rich text={callParty.contact.note} />
            </p>
          )}
        </div>
      )}
      {urgent && callParty && callPhone && (
        <div className="alert-panel alert-panel--warning">
          <p className="alert-panel__label">
            <Icon name="warning" size={20} /> Срочно
          </p>
          <p className="alert-panel__title">Позвоните сейчас: {callParty.contact?.name ?? callParty.title}</p>
          <Button kind="primary" block href={telHref(callPhone.number)} icon={<Icon name="call" />} onClick={() => onCall(callPhone.number)}>
            Позвонить
          </Button>
          <p className="alert-panel__note">
            <strong>{callPhone.number}</strong> · {callParty.contact?.hours ?? callPhone.label}
          </p>
        </div>
      )}

      {/* при угрозе жизни главное – что делать прямо сейчас */}
      {emergency && steps}

      <div className={`verdict verdict--${outcome.certainty}`}>
        <div className="verdict__badges">
          <CertaintyBadge certainty={outcome.certainty} />
          <BasisBadge basis={outcome.basis} />
        </div>
        <h2 className="verdict__title">{outcome.headline}</h2>
        <p className="verdict__problem">
          {element.title} · {problem.title}
        </p>
      </div>

      <Section title="Кто отвечает">
        <div className="stack">
          {primary && <ServiceCard party={primary} house={house} primary onWhy={scrollToWhy} onCall={onCall} onChooseHouse={() => open({ t: 'houses' })} />}
          {others.length > 0 && <p className="stack__label">Также участвуют</p>}
          {others.map((p) => (
            <ServiceCard key={p.id} party={p} house={house} onCall={onCall} onChooseHouse={() => open({ t: 'houses' })} />
          ))}
        </div>
      </Section>

      <Section title="Почему сюда" id="why">
        <p className="text">{outcome.why}</p>
        {outcome.note && <Callout tone="info">{outcome.note}</Callout>}
      </Section>

      {outcome.certainty === 'disputed' ? (
        <Callout tone="warning" title="Спорный случай">
          <p>{BASIS_HINT[outcome.basis]} Поэтому приложение не даёт уверенного ответа.</p>
          <p>Попросите письменный ответ: текст обращения уже подготовлен, адрес и организация подставлены.</p>
          <Button kind="primary" block icon={<Icon name="request" />} onClick={() => open({ t: 'request', problemId: problem.id, answers })}>
            Составить обращение
          </Button>
        </Callout>
      ) : null}

      {!emergency && steps}

      {outcome.certainty === 'clear' && outcome.request && (
        <Button kind="secondary" block icon={<Icon name="request" />} onClick={() => open({ t: 'request', problemId: problem.id, answers })}>
          Составить обращение
        </Button>
      )}

      <Section title="На чём основан ответ" hint="Нажмите на норму, чтобы прочитать подробнее.">
        <div className="card-list">
          {outcome.norms.map((id) => {
            const n = getNorm(id);
            return (
              <button key={id} type="button" className="norm-row" onClick={() => open({ t: 'norm', id })}>
                <span className="norm-row__icon">
                  <Icon name="norm" size={20} />
                </span>
                <span className="norm-row__main">
                  <span className="norm-row__short">{n.short}</span>
                  <span className="norm-row__gist">{n.gist}</span>
                </span>
                <Icon name="forward" size={20} className="list-row__chev" />
              </button>
            );
          })}
        </div>
      </Section>

      {escalate && (
        <Section title="Если не реагируют или отказывают">
          <ServiceCard party={resolveParties(house, ['housing_inspection'])[0]!} house={house} onCall={onCall} />
        </Section>
      )}

      <Button kind="ghost" block icon={<Icon name="share" />} onClick={share}>
        Отправить в чат
      </Button>

      <p className="fineprint">
        Справочная информация, не юридическая консультация.
        {house.isDemo ? ' Организации и телефоны этого дома – демонстрационные.' : ` Контакты – на ${house.updatedAt.split('-').reverse().join('.')}; если номер не отвечает, сверьтесь с квитанцией.`}
      </p>
    </div>
  );
}
