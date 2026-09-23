import { getNorm } from './data/norms';
import { localize } from './engine';
import type { HouseElement, HouseProfile, Outcome, Problem, RequestKind } from './types';

export interface UserInfo {
  name?: string;
  entrance?: string;
  flat?: string;
  phone?: string;
}

export interface RequestContext {
  element: HouseElement;
  problem: Problem;
  user?: UserInfo;
  date?: Date;
}

export interface BuiltRequest {
  kind: RequestKind;
  title: string;
  to: string;
  body: string;
}

export const REQUEST_TITLES: Record<RequestKind, string> = {
  repair: 'Заявка на устранение неисправности',
  clarify: 'Запрос: кто отвечает и что будет сделано',
  act: 'Заявление о составлении акта',
  recalc: 'Заявление о перерасчёте платы',
};

const fmtDate = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

const blank = (v: string | undefined, hint: string) => (v && v.trim() ? v.trim() : `[${hint}]`);

/**
 * Собирает текст обращения. Все данные подставляются на устройстве –
 * ничего не отправляется: пользователь копирует текст или делится им сам.
 * outcome – уже локализованный под дом исход (localizeOutcome) либо исходный: тексты исхода в письмо не попадают.
 */
export function buildRequest(kind: RequestKind, outcome: Outcome, house: HouseProfile, ctx: RequestContext): BuiltRequest {
  const { element, problem } = ctx;
  const user = ctx.user ?? {};
  const date = fmtDate(ctx.date ?? new Date());
  const manager = house.contacts.manager;
  const to = manager
    ? `${manager.name}${manager.inn ? ` (ИНН ${manager.inn})` : ''}${manager.address ? `, ${manager.address}` : ''}`
    : localize('[название {M_gen}]', house);
  // до выбора дома адрес известен только до города
  const address = house.id === 'none' ? `${house.address}, [улица, дом]` : house.address;
  const where = [
    user.entrance ? `подъезд ${user.entrance}` : '',
    user.flat ? `кв. ${user.flat}` : '',
  ].filter(Boolean).join(', ');
  const fromLine =
    `От: ${blank(user.name, 'ФИО')}, проживающего(ей) по адресу: ${address}` +
    `${user.flat ? `, кв. ${user.flat}` : ', кв. [номер]'}. Тел.: ${blank(user.phone, 'телефон')}`;
  const subject = `${element.title}: ${problem.title.charAt(0).toLowerCase()}${problem.title.slice(1)}`;
  const norms = outcome.norms.map((id) => getNorm(id).short);
  const normsLine = norms.length ? `Основание: ${norms.join('; ')}.` : '';
  const placeLine = `Место: ${where || 'подъезд [номер], этаж [номер]'}.`;

  let body: string;
  switch (kind) {
    case 'repair':
      body = [
        `Прошу принять меры по устранению неисправности в многоквартирном доме по адресу: ${address}.`,
        `Суть: ${subject}.`,
        placeLine,
        'Описание: [опишите, что видите: когда заметили, как проявляется, есть ли опасность].',
        normsLine,
        'Прошу зарегистрировать обращение, сообщить номер заявки и сроки устранения, а по итогам – письменно уведомить меня о выполненных работах.',
      ].filter(Boolean).join('\n\n');
      break;
    case 'clarify':
      body = [
        `Прошу дать письменный ответ по вопросу: ${subject}. Адрес: ${address}.`,
        placeLine,
        `Прошу ответить: 1) относится ли данный объект к общему имуществу многоквартирного дома и кто отвечает за его содержание и ремонт (со ссылкой на документы: состав общего имущества, договор управления, техническая документация); 2) если ответственность лежит на ${localize('{M_dat}', house)}, – в какой срок будет выполнена работа; 3) если ответственность лежит на собственнике или иной организации – на каком основании и к кому мне обратиться.`,
        normsLine,
        'Прошу зарегистрировать обращение и предоставить письменный мотивированный ответ.',
      ].filter(Boolean).join('\n\n');
      break;
    case 'act':
      body = [
        `Прошу направить комиссию и составить акт осмотра по факту: ${subject}. Адрес: ${address}.`,
        placeLine,
        'Дата и время обнаружения: [дата, время].',
        'Обнаруженные повреждения: [перечислите: что пострадало, площадь, есть ли фото].',
        'Прошу указать в акте причину и источник (если известен), а также перечень повреждений. Копию акта прошу выдать мне.',
        normsLine,
      ].filter(Boolean).join('\n\n');
      break;
    case 'recalc':
      body = [
        `Сообщаю о нарушении качества коммунальной услуги по адресу: ${address}: ${subject}.`,
        placeLine,
        'Период нарушения: с [дата, время] по [дата, время / продолжается]. Показания замеров: [например, температура в комнате, фото].',
        'Обращение в аварийно-диспетчерскую службу: [дата, время, номер заявки, кто принял].',
        'Прошу зафиксировать факт нарушения актом и выполнить перерасчёт платы за период нарушения. Копию акта прошу выдать мне.',
        'Основание: Правила предоставления коммунальных услуг (ПП № 354), разд. X и приложение 1.',
      ].filter(Boolean).join('\n\n');
      break;
  }

  const text = [
    `Кому: ${to}`,
    fromLine,
    '',
    `${REQUEST_TITLES[kind].toUpperCase()}`,
    '',
    body,
    '',
    `Дата: ${date}   Подпись: ____________`,
  ].join('\n');

  return { kind, title: REQUEST_TITLES[kind], to, body: text };
}
