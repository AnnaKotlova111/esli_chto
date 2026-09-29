import {
  ADDRESS_EXAMPLES, CITY, HOUSES, decodeDeepLink, emergencyPartyOf, emphasize, encodeDeepLink, formatDateRu, getElement, getHouse, getProblem,
  isHouseChosen, isKnownHouse, localizeOutcome, localizeQuestion, needsHouseChoice, organizationOf, resolve, resolveParties, search,
  plural, searchHouses,
  type HouseProfile, type Outcome, type PartyId,
} from '@esli-chto/core';

/**
 * Ответы бота. Только чистые функции «данные → текст и кнопки» – их можно проверять без MAX.
 * В чате – короткий ответ «кто отвечает и куда звонить»; схемы, обращения и подробности – в мини-приложении.
 */

export type ChatButton =
  | { kind: 'cb'; text: string; payload: string }
  | { kind: 'app'; text: string; payload?: string };

export interface ChatReply {
  text: string;
  buttons: ChatButton[][];
}

const MAX_TEXT = 3800;
/**
 * Обрезает слишком длинное сообщение по границе строки: разметка (<b>, <i>, <u>) открывается
 * и закрывается внутри одной строки, поэтому после обрезки она остаётся корректной.
 */
const clip = (s: string) => {
  if (s.length <= MAX_TEXT) return s;
  const cut = s.lastIndexOf('\n', MAX_TEXT - 1);
  return `${s.slice(0, cut > 0 ? cut : MAX_TEXT - 1)}\n…`;
};

// Тексты сообщений – в разметке HTML (сервер отправляет их с format: 'html').
// Любые данные перед вставкой экранируются; <b> – главное (номера, запреты), <i> – второстепенное.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const b = (s: string) => `<b>${esc(s)}</b>`;
const em = (s: string) => `<i>${esc(s)}</i>`;
/** Текст шага или подсказки с выделенными номерами и запретами. */
const rich = (s: string) => emphasize(s).map((p) => (p.strong ? b(p.text) : esc(p.text))).join('');
/** В приложении шаблон обращения – ниже на экране, в чате – по кнопке приложения. */
export const stepForChat = (s: string) => s.replace(/\s*\(шаблон(?: обращения)?(?: –)? ниже\)/, ' (шаблон – в приложении)');
/** Склеивает строки, не допуская двух пустых подряд. */
const lines = (arr: string[]) => arr.filter((l, n, a) => l !== '' || (n > 0 && a[n - 1] !== '')).join('\n').trim();

/** Значки сторон в чате – простые символы, которые есть на любом устройстве. */
const PARTY_MARK: Record<PartyId, string> = {
  manager: '🏢', dispatch: '🚨', owner: '🏠', neighbor: '👥', water_utility: '💧', heat_utility: '🔥', energy_utility: '⚡',
  gas_service: '🔧', gas_emergency: '☎️', tko_operator: '🚛', lift_service: '↕️', intercom_service: '🔔', municipality: '🏛️',
  housing_inspection: '📋', police: '👮', telecom: '📡', emergency112: '🆘',
};

// Для города, подключённого с тестовыми данными (meta.json: "demo": true), – явная пометка по п. 10 ограничений ТЗ.
const DEMO_NOTE = 'Демо-данные: организации и телефоны вымышлены, реальны только 112, 104 и 102.';
const DATA_NOTE = `Контакты – из открытых данных на ${formatDateRu(CITY.updatedAt)}; если номер не отвечает, сверьтесь с квитанцией.`;
const dataNote = (house: HouseProfile) => (house.isDemo ? DEMO_NOTE : DATA_NOTE);

// ─────────────── Данные кнопок (callback) ───────────────
//  p:<problemId>:<a.b.c>  – ситуация и цепочка ответов
//  e:<elementId>          – список ситуаций объекта
//  h:<houseId>            – выбрать дом
//  hl:<страница>          – список домов по страницам
//  menu | urgent | houses

export type CallbackAction =
  | { t: 'problem'; problemId: string; answers: number[] }
  | { t: 'element'; elementId: string }
  | { t: 'house'; houseId: string }
  | { t: 'menu' }
  | { t: 'urgent' }
  | { t: 'houses' }
  | { t: 'housesPage'; page: number };

export const cbProblem = (problemId: string, answers: number[] = []) => `p:${problemId}:${answers.join('.')}`;

export function parseCallback(payload: string | undefined | null): CallbackAction | undefined {
  if (!payload || payload.length > 200) return undefined;
  if (payload === 'menu') return { t: 'menu' };
  if (payload === 'urgent') return { t: 'urgent' };
  if (payload === 'houses') return { t: 'houses' };
  const [kind, a, b, extra] = payload.split(':');
  if (extra !== undefined) return undefined;
  if (kind === 'p' && a && getProblem(a)) {
    const answers = b ? b.split('.').map(Number) : [];
    if (answers.some((n) => !Number.isInteger(n) || n < 0 || n > 9) || answers.length > 5) return undefined;
    return { t: 'problem', problemId: a, answers };
  }
  if (kind === 'e' && a && getElement(a) && b === undefined) return { t: 'element', elementId: a };
  if (kind === 'h' && a && isKnownHouse(a) && b === undefined) return { t: 'house', houseId: a };
  if (kind === 'hl' && a && /^\d{1,2}$/.test(a) && b === undefined) {
    const page = Number(a);
    if (page < housesPages()) return { t: 'housesPage', page };
  }
  return undefined;
}

const appBtn = (house: HouseProfile, text: string, target?: { problemId?: string; elementId?: string }): ChatButton => ({
  kind: 'app',
  text,
  payload: encodeDeepLink({ houseId: house.id, ...target }),
});

const menuRow = (): ChatButton[] => [{ kind: 'cb', text: '🔎 Другая ситуация', payload: 'menu' }];

/** «Назад» в диалоге ситуации: к предыдущему вопросу, а с первого шага – к списку ситуаций объекта. */
const backButton = (elementId: string, problemId: string, answers: number[]): ChatButton => ({
  kind: 'cb',
  text: '‹ Назад',
  payload: answers.length ? cbProblem(problemId, answers.slice(0, -1)) : `e:${elementId}`,
});

/** Ответ на кнопку «Другая ситуация». */
export function menuReply(): ChatReply {
  return {
    text: 'Опишите, что случилось, своими словами – например: «течёт кран», «нет света в подъезде».',
    buttons: [[{ kind: 'app', text: '🏢 Открыть карту дома' }], [{ kind: 'cb', text: '🚨 Срочно', payload: 'urgent' }]],
  };
}

// ─────────────── Экраны ───────────────

export function welcome(house: HouseProfile): ChatReply {
  return {
    text: clip(
      lines([
        `👋 Здравствуйте! Это ${b('«Если что»')} – помощник для жителей многоквартирных домов.`,
        '',
        'Что-то сломалось в квартире, подъезде или во дворе? Подскажу, кто за это отвечает, дам телефон нужной организации и шаги. Норму закона, на которую можно сослаться, покажет мини-приложение.',
        '',
        `${b('Как начать:')} напишите своими словами, что случилось, – например, «течёт кран», «не горит свет в подъезде», «нет горячей воды».`,
        '',
        `🏢 ${b('Карта дома')} – мини-приложение, кнопка ниже:`,
        '• схемы двора, подъезда, подвала и квартиры – нажмите на сломанный предмет, даже если не знаете, как он называется;',
        '• раздел «Срочно» – все аварийные ситуации и номера в одно касание;',
        '• готовое обращение в управляющую организацию с адресом и ИНН – для спорных случаев.',
        '',
        isHouseChosen(house)
          ? `🏠 Ваш дом: ${b(house.address)}\nУправляет: ${esc(house.contacts.manager?.name ?? house.managerKind)}`
          : `📍 Чтобы видеть телефоны своей управляющей организации, выберите дом: /house и адрес.`,
        '',
        `🆘 Угроза жизни, пожар – ${b('112')}`,
        `🔥 Запах газа – ${b('104')}`,
        '',
        em('/help – все команды. Это справочная информация, а не юридическая консультация.'),
      ]),
    ),
    buttons: [
      [appBtn(house, '🏢 Открыть карту дома')],
      [{ kind: 'cb', text: '🚨 Срочно: газ, пожар, потоп', payload: 'urgent' }],
      [{ kind: 'cb', text: isHouseChosen(house) ? '📍 Сменить дом' : '📍 Выбрать свой дом', payload: 'houses' }],
    ],
  };
}

export function help(house: HouseProfile): ChatReply {
  return {
    text: lines([
      b('Как пользоваться'),
      '',
      'Напишите, что случилось, – подскажу, кто отвечает и куда звонить.',
      '',
      '/urgent – срочные и экстренные номера',
      '/house – выбрать свой дом',
      '/houses – список всех домов',
      '/forget – забыть выбранный дом',
      '',
      em('Бот отвечает только в личных сообщениях. Это справочная информация, а не юридическая консультация.'),
    ]),
    buttons: [[appBtn(house, '🏢 Открыть карту дома')]],
  };
}

export function emergencyReply(house: HouseProfile): ChatReply {
  const rows: [PartyId, string][] = [
    ['emergency112', 'Пожар, угроза жизни, обрушение'],
    ['gas_emergency', 'Запах газа. Звоните <u>не из квартиры</u>'],
    ['police', 'Нарушение порядка, опасность от людей'],
    ['dispatch', 'Авария в доме: прорыв трубы, нет света, воды или тепла'],
  ];
  const blocks = rows.map(([id, what]) => {
    const p = resolveParties(house, [id])[0]!;
    const phones = p.contact?.phones.map((x) => b(x.number)).join(', ');
    const ph = phones ?? (isHouseChosen(house) ? 'контакт не указан' : 'выберите дом командой /house');
    return `${PARTY_MARK[id]} ${esc(p.contact?.name ?? p.title)}: ${ph}\n${what}`;
  });
  return {
    text: clip(
      lines([
        `🚨 ${b('Срочные номера')}`,
        '',
        blocks.join('\n\n'),
        '',
        `<b><u>При угрозе жизни сначала звоните 112</u></b>, остальное – потом.`,
      ]),
    ),
    buttons: [
      [{ kind: 'cb', text: '🔥 Запах газа', payload: cbProblem('gas_stove__smell') }],
      [{ kind: 'cb', text: '💨 Пожар или дым в подъезде', payload: cbProblem('fire_safety__fire') }],
      [{ kind: 'cb', text: '♨️ Прорыв трубы горячей воды', payload: cbProblem('riser_flat__scald') }],
      [{ kind: 'cb', text: '🌊 Протечка трубы в квартире', payload: cbProblem('pipes_valves__leak') }],
      [appBtn(house, '🏢 Все срочные ситуации в приложении')],
      menuRow(),
    ],
  };
}

/** Приглашение написать адрес – ответ на /house и кнопку «Сменить дом». */
export function askAddressReply(house: HouseProfile): ChatReply {
  return {
    text: [
      isHouseChosen(house) ? `Сейчас выбран: ${b(house.address)}` : '',
      `Напишите адрес своего дома – улицу и номер, например ${b(ADDRESS_EXAMPLES[0]!)}.`,
      em(`В справочнике ${HOUSES.length} ${plural(HOUSES.length, 'дом', 'дома', 'домов')}: ${Object.values(CITY.settlements).join(', ')}.`),
    ].filter(Boolean).join('\n\n'),
    buttons: [[{ kind: 'cb', text: '📋 Список всех домов', payload: 'hl:0' }], menuRow()],
  };
}

/**
 * Дома по адресу. Если номер в запросе совпал с номером одного дома целиком, остаётся только он:
 * «Ленинградская 6» – это дом 6, а не 60 и 62.
 */
function housesByAddress(query: string, limit: number): HouseProfile[] {
  const hits = searchHouses(query, limit);
  const number = query.trim().split(/[\s,]+/).pop()?.toLowerCase();
  const exact = hits.filter((h) => h.title.toLowerCase().endsWith(`, ${number}`));
  return exact.length === 1 ? exact : hits;
}

/** Примеры адресов подключённого города: «Коровина 11» или «Ленинградская 6» – для Вичуги. */
const examplesText = () => ADDRESS_EXAMPLES.slice(0, 2).map((a) => `«${a}»`).join(' или ');

/**
 * Сколько домов показывать кнопками на выбор. MAX допускает до 30 рядов кнопок, один занят «Другой ситуацией»,
 * поэтому улица целиком (в Вичуге самая длинная – Ленинградская, 28 домов) помещается в одно сообщение.
 */
export const HOUSE_CHOICES = 28;

/** Разбор адреса: один дом – выбираем сразу, несколько – просим уточнить кнопками. */
export function addressReply(query: string): { houseId?: string; reply?: ChatReply } {
  // на один дом больше лимита – чтобы знать, что показаны не все
  const hits = housesByAddress(query, HOUSE_CHOICES + 1);
  if (hits.length === 1) return { houseId: hits[0]!.id };
  if (hits.length === 0) {
    return {
      reply: {
        text: `Не нашёл такой адрес в справочнике. Напишите улицу и номер дома, например ${examplesText()}.`,
        buttons: [[{ kind: 'cb', text: '📋 Список всех домов', payload: 'hl:0' }], menuRow()],
      },
    };
  }
  const shown = hits.slice(0, HOUSE_CHOICES);
  // не поместившиеся дома не пропадают молча: подсказываем написать адрес с номером
  const hidden = hits[HOUSE_CHOICES];
  return {
    reply: {
      text: hidden
        ? `Какой из домов ваш? Показаны не все дома – если вашего нет, напишите адрес с номером, например «${hidden.title.replace(/\s*\(.*\)$/, '')}».`
        : 'Какой из домов ваш?',
      buttons: [...shown.map((h): ChatButton[] => [{ kind: 'cb', text: h.title, payload: `h:${h.id}` }]), menuRow()],
    },
  };
}

/** Подтверждение выбора дома: организация и её телефоны из справочника. */
export function houseChosenReply(house: HouseProfile): ChatReply {
  const m = house.contacts.manager;
  const d = house.contacts.dispatch;
  return {
    text: clip(
      lines([
        `🏠 Ваш дом: ${b(house.address)}`,
        '',
        `${house.managerKind === 'УК' ? 'Управляющая организация' : `Форма управления: ${house.managerKind}`}:`,
        esc(m?.name ?? '–'),
        m?.phones.length ? `📞 ${m.phones.map((p) => b(p.number)).join(', ')}` : '',
        d ? `🚨 Аварийная служба: ${d.phones.map((p) => b(p.number)).join(', ')}` : '',
        m?.note ? `\n${em(m.note)}` : '',
        '',
        'Теперь напишите, что случилось, – подскажу, кто отвечает.',
        '',
        em(dataNote(house)),
      ]),
    ),
    buttons: [[appBtn(house, '🏢 Открыть карту дома')], [{ kind: 'cb', text: '🚨 Срочно: газ, пожар, потоп', payload: 'urgent' }]],
  };
}

const PAGE = 40;
const housesPages = () => Math.ceil(HOUSES.length / PAGE);

/** Список всех домов справочника по страницам – команда /houses. */
export function housesListReply(currentId: string, requested?: number): ChatReply {
  const pages = housesPages();
  // без номера страницы открываем ту, где выбранный дом
  const page = requested ?? Math.max(0, Math.floor(HOUSES.findIndex((h) => h.id === currentId) / PAGE));
  const slice = HOUSES.slice(page * PAGE, (page + 1) * PAGE);
  const rows = slice.map((h) => `${h.id === currentId ? '✓' : '•'} ${esc(h.title)} – ${esc(organizationOf(h.id)?.short ?? h.managerKind)}`);
  const nav: ChatButton[] = [];
  if (page > 0) nav.push({ kind: 'cb', text: '‹ Назад', payload: `hl:${page - 1}` });
  if (page < pages - 1) nav.push({ kind: 'cb', text: 'Дальше ›', payload: `hl:${page + 1}` });
  return {
    text: clip([b(`Дома справочника (${HOUSES.length}), страница ${page + 1} из ${pages}`), '', ...rows, '', 'Чтобы выбрать свой дом, напишите его адрес после команды /house.'].join('\n')),
    buttons: [...(nav.length ? [nav] : []), [{ kind: 'cb', text: '📍 Выбрать свой дом', payload: 'houses' }], menuRow()],
  };
}

export function searchReply(query: string, house: HouseProfile): ChatReply {
  const top = search(query, house, 5);

  if (top.length === 0) {
    const houses = /\d/.test(query) ? housesByAddress(query, 3) : [];
    if (houses.length) {
      return {
        text: 'Похоже на адрес. Сделать этот дом вашим? Тогда в ответах будут телефоны его управляющей организации.',
        buttons: [...houses.map((h): ChatButton[] => [{ kind: 'cb', text: `📍 ${h.title}`, payload: `h:${h.id}` }]), menuRow()],
      };
    }
    return {
      text: 'Не нашёл подходящей ситуации. Попробуйте другими словами («течёт», «не горит», «засор», «нет воды», «лифт») или найдите предмет на схеме в мини-приложении.',
      buttons: [[appBtn(house, '🏢 Найти на схеме дома')], [{ kind: 'cb', text: '🚨 Срочно', payload: 'urgent' }]],
    };
  }
  return {
    text: top.length === 1 ? 'Похоже, это оно. Нажмите – покажу, кто отвечает и куда звонить.' : 'Что из этого случилось? Нажмите – покажу, кто отвечает и куда звонить.',
    buttons: [
      ...top.map((h): ChatButton[] => [
        h.problemId ? { kind: 'cb', text: h.title, payload: cbProblem(h.problemId) } : { kind: 'cb', text: `${h.title} – выбрать ситуацию`, payload: `e:${h.elementId}` },
      ]),
      [appBtn(house, '🏢 Открыть карту дома')],
    ],
  };
}

// ─────────────── Приветствия и разговорные фразы ───────────────

/** Приветствия и слова «начать»: в ответ – рассказ о боте, а не поиск поломки. */
const GREETINGS = [
  'привет', 'приветик', 'приветствую', 'здравствуй', 'здравствуйте', 'здрасте', 'здрасьте', 'добрый день', 'добрый вечер',
  'доброе утро', 'доброй ночи', 'доброго времени суток', 'хай', 'салют', 'hi', 'hello', 'старт', 'start', 'начать', 'меню',
];
const HELP_PHRASES = ['помощь', 'помогите', 'справка', 'help', 'что ты умеешь', 'что умеешь', 'как пользоваться', 'кто ты', 'что это', 'что это за бот', 'зачем ты нужен'];
const THANKS = ['спасибо', 'спасибо большое', 'большое спасибо', 'благодарю', 'спс'];

const normalizePhrase = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
/** Длинные фразы проверяем первыми, чтобы «добрый день» не распознавался частями. */
const byLength = (list: string[]) => list.map(normalizePhrase).sort((x, y) => y.length - x.length);
const GREETING_LIST = byLength(GREETINGS);
const HELP_LIST = byLength(HELP_PHRASES);
const THANKS_LIST = byLength(THANKS);
const leadingPhrase = (text: string, list: string[]) => list.find((p) => text === p || text.startsWith(`${p} `));

export function thanksReply(house: HouseProfile): ChatReply {
  return {
    text: 'Пожалуйста! Если что-то ещё случится – просто напишите, что произошло.',
    buttons: [[appBtn(house, '🏢 Открыть карту дома')], [{ kind: 'cb', text: '🚨 Срочно', payload: 'urgent' }]],
  };
}

/**
 * Ответ на свободный текст. «Привет», «начать», «что ты умеешь», «спасибо» – разговорные фразы, на них бот
 * рассказывает о себе. Приветствие перед описанием («Здравствуйте, течёт кран») отбрасывается, остальное ищется.
 */
export function textReply(query: string, house: HouseProfile): ChatReply {
  let rest = normalizePhrase(query);
  let greeted = false;
  for (let p = leadingPhrase(rest, GREETING_LIST); p; p = leadingPhrase(rest, GREETING_LIST)) {
    rest = rest.slice(p.length).trim();
    greeted = true;
  }
  if (!rest) return welcome(house);
  if (leadingPhrase(rest, HELP_LIST) === rest) return help(house);
  if (leadingPhrase(rest, THANKS_LIST) === rest) return thanksReply(house);
  // «Здравствуйте, подскажите пожалуйста» – поломки в тексте нет, поэтому рассказываем, как пользоваться
  if (greeted && search(rest, house, 1).length === 0 && !/\d/.test(rest)) return welcome(house);
  return searchReply(greeted ? rest : query, house);
}

/** Фото, стикер, файл или геометка вместо текста: бот понимает только слова – подсказываем, а не молчим. */
export function nonTextReply(house: HouseProfile): ChatReply {
  return {
    text: 'Я понимаю только текст. Опишите, что случилось, словами – например: «течёт кран», «нет света в подъезде». Или найдите предмет на схеме дома.',
    buttons: [[appBtn(house, '🏢 Открыть карту дома')], [{ kind: 'cb', text: '🚨 Срочно', payload: 'urgent' }]],
  };
}

export function elementReply(elementId: string, house: HouseProfile): ChatReply {
  const el = getElement(elementId);
  if (!el) return welcome(house);
  return {
    text: `${b(el.title)}\n${esc(el.about)}\n\nЧто случилось?`,
    buttons: [
      ...el.problems.map((p): ChatButton[] => [{ kind: 'cb', text: p.title, payload: cbProblem(p.id) }]),
      [appBtn(house, '🏢 Показать на схеме', { elementId })],
      menuRow(),
    ],
  };
}

function renderOutcome(elementTitle: string, problemTitle: string, o: Outcome, house: HouseProfile, emergency: boolean): string {
  const parties = resolveParties(house, o.responsible);
  const danger = emergency ? resolveParties(house, [emergencyPartyOf(o) ?? 'emergency112'])[0] : undefined;
  const head = `${o.certainty === 'clear' ? '✅' : '⚠️'} ${b(o.headline)}`;
  // Каждая сторона – отдельным блоком: название, телефоны по одному в строке, у основной – часы и пояснение.
  const who = parties.map((p, n) => {
    const c = p.contact;
    const name = c?.name && p.id !== 'owner' ? c.name : p.title;
    const phones = c?.phones.map((x) => `📞 ${b(x.number)}${x.label ? ` – ${esc(x.label)}` : ''}`) ?? [];
    const missing = needsHouseChoice(house, p) ? 'Выберите свой дом командой /house – покажу телефон.' : 'Контакта нет в справочнике, номер – в квитанции.';
    const detail =
      p.id === 'owner' || p.id === 'neighbor' || phones.length ? '' : p.missingContact ? missing : (c?.note ?? p.role);
    const extra = n === 0 ? [c?.hours ? `🕒 ${esc(c.hours)}` : '', phones.length && c?.note ? em(c.note) : ''] : [];
    return [`${n === 0 ? '👉 ' : ''}${PARTY_MARK[p.id]} ${b(name)}`, ...phones, detail ? esc(detail) : '', ...extra].filter(Boolean).join('\n');
  });
  // Шаги – главное в помощи, поэтому в чате они всегда полностью; пояснение и нормы – в приложении.
  const steps = o.steps.map((s, n) => `${n + 1}. ${rich(stepForChat(s))}`).join('\n\n');
  const whoBlock = [b('Куда обращаться'), '', who.join('\n\n')];
  const stepsBlock = [b('Что делать'), '', steps];
  return clip(
    lines([
      ...(danger ? [`🆘 <b><u>Опасно: сначала звоните ${esc(danger.contact?.phones[0]?.number ?? '112')}</u></b>`, ''] : []),
      head,
      esc(`${elementTitle} · ${problemTitle}`),
      '',
      // при угрозе жизни сначала – что делать, при остальных – кому звонить
      ...(emergency ? [...stepsBlock, '', ...whoBlock] : [...whoBlock, '', ...stepsBlock]),
      '',
      em(
        o.certainty === 'disputed'
          ? 'Случай спорный: почему так, нормы и готовый текст обращения – в приложении.'
          : 'Почему так и на какие нормы это опирается – в приложении.',
      ),
      em(isHouseChosen(house) ? dataNote(house) : 'Справочная информация, не юридическая консультация.'),
    ]),
  );
}

export function problemReply(problemId: string, answers: number[], house: HouseProfile): ChatReply {
  const found = getProblem(problemId);
  if (!found) return welcome(house);
  const { element, problem } = found;
  const r = resolve(problem, answers);
  // недействительные ответы разбор отбрасывает – «Назад» считается от того шага, где пользователь на самом деле находится
  const navRow = [backButton(element.id, problemId, answers.slice(0, r.depth)), ...menuRow()];

  if (r.status === 'question') {
    const q = localizeQuestion(r.question, house);
    return {
      text: clip(
        lines([
          problem.urgency === 'emergency' ? `🆘 ${b('Опасно:')} при угрозе жизни сразу звоните ${b('112')}, при запахе газа – ${b('104')}.\n` : '',
          `${b(element.title)} · ${esc(problem.title)}`,
          '',
          `❓ ${b(q.ask)}`,
          q.hint ? em(q.hint) : '',
        ]),
      ),
      buttons: [...q.options.map((o, i): ChatButton[] => [{ kind: 'cb', text: o.label, payload: cbProblem(problemId, [...answers.slice(0, r.depth), i]) }]), navRow],
    };
  }
  const outcome = localizeOutcome(r.outcome, house);
  return {
    text: renderOutcome(element.title, problem.title, outcome, house, problem.urgency === 'emergency'),
    buttons: [[appBtn(house, outcome.request ? '📝 Подробнее и шаблон обращения' : '🏢 Подробнее в приложении', { problemId })], navRow],
  };
}

/** Дом из диплинка, если он есть в справочнике: сервер запоминает его как дом пользователя. */
export function houseFromStart(payload: string | undefined | null): string | undefined {
  const { houseId } = decodeDeepLink(payload ?? undefined);
  return houseId && isKnownHouse(houseId) ? houseId : undefined;
}

/** Старт по диплинку: /start с параметром или событие bot_started с payload. */
export function startReply(payload: string | undefined | null, house: HouseProfile): ChatReply {
  const link = decodeDeepLink(payload ?? undefined);
  const linkHouse = houseFromStart(payload);
  const target = getHouse(linkHouse ?? house.id);
  if (link.problemId) return problemReply(link.problemId, [], target);
  if (link.elementId) return elementReply(link.elementId, target);
  // в ссылке только дом – показываем его карточку, а не прежний дом пользователя
  if (linkHouse) return houseChosenReply(target);
  return welcome(house);
}
