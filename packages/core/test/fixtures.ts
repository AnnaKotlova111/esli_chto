import { CITY, HOUSES, getHouse, type HouseProfile } from '../src';

/**
 * Дома для тестов, которые проходят на справочнике любого подключённого города (data/<город>, см. data/README.md).
 * Проверки конкретных домов, организаций и телефонов пилотного города выполняются, только когда подключена Вичуга (PILOT).
 */
export const PILOT = CITY.name === 'Вичуга';

const find = (pilotId: string, test: (h: HouseProfile) => boolean): HouseProfile => {
  const h = PILOT ? getHouse(pilotId) : HOUSES.find(test);
  if (!h || h.id === 'none') throw new Error(`В справочнике ${CITY.name} нет дома для тестов (${pilotId}) – см. data/README.md, раздел «Что нужно для тестов»`);
  return h;
};

/** Дом управляющей компании с отдельной диспетчерской. В Вичуге – ул. Коровина, 11 (УК «Жилищно-ремонтный участок №1»). */
export const UK_HOUSE = find('vch_korovina_11', (h) => h.managerKind === 'УК' && Boolean(h.contacts.dispatch));

/** Дом ТСЖ, ЖСК или ТСН без отдельной диспетчерской: аварии принимает правление. В Вичуге – ТСЖ «Старатели», Пятницкий пер., 13. */
export const BOARD_HOUSE = find('vch_pyatnitskiy_13', (h) => h.managerKind !== 'УК' && !h.contacts.dispatch);

/** Организация дома и её телефоны – чтобы проверять тексты ответов данными справочника, а не выписанными вручную строками. */
export const managerOf = (h: HouseProfile) => h.contacts.manager!;
export const dispatchPhone = (h: HouseProfile) => h.contacts.dispatch!.phones[0]!.number;
export const managerPhone = (h: HouseProfile) => h.contacts.manager!.phones[0]!.number;

/** Запрос, по которому житель находит дом: «ул. Коровина, 11» → «Коровина 11». */
export const addressQuery = (h: HouseProfile) => h.title.replace(/\s*\(.*\)$/, '').replace(/^(ул|пер|пр-т|просп|пл|б-р|ш)\.\s+|\s+(пер|ул)\.(?=,)/g, '').replace(',', '');
