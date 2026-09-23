import type { PartyId, PartyInfo } from '../types';

export const PARTIES: Record<PartyId, PartyInfo> = {
  manager: { id: 'manager', title: 'Управляющая организация', role: 'Содержит общее имущество дома и принимает заявки жителей', icon: 'building', hasContacts: true },
  dispatch: { id: 'dispatch', title: 'Аварийно-диспетчерская служба', role: 'Круглосуточно принимает сообщения об авариях и передаёт бригадам', icon: 'siren', hasContacts: true },
  owner: { id: 'owner', title: 'Вы (собственник)', role: 'Содержание и ремонт внутри вашей квартиры – за ваш счёт', icon: 'home', hasContacts: false },
  neighbor: { id: 'neighbor', title: 'Собственник соседней квартиры', role: 'Отвечает за своё оборудование и ущерб, причинённый другим', icon: 'users', hasContacts: false },
  water_utility: { id: 'water_utility', title: 'Водоканал', role: 'Водопровод до дома и качество воды на входе в дом', icon: 'droplets', hasContacts: true },
  heat_utility: { id: 'heat_utility', title: 'Теплоснабжающая организация', role: 'Отопление и горячая вода до дома', icon: 'thermometer', hasContacts: true },
  energy_utility: { id: 'energy_utility', title: 'Энергосбыт / сетевая организация', role: 'Электричество до дома, счётчики электроэнергии', icon: 'zap', hasContacts: true },
  gas_service: { id: 'gas_service', title: 'Газовая организация (ТО)', role: 'Проверка и ремонт газового оборудования по договору', icon: 'wrench', hasContacts: true },
  gas_emergency: { id: 'gas_emergency', title: 'Аварийная газовая служба', role: 'Запах газа, утечки, отравление – круглосуточно', icon: 'flame', hasContacts: true },
  tko_operator: { id: 'tko_operator', title: 'Вывоз мусора (региональный оператор)', role: 'Вывоз мусора из контейнеров', icon: 'truck', hasContacts: true },
  lift_service: { id: 'lift_service', title: 'Лифтовая организация', role: 'Ремонт лифтов и связь с кабиной', icon: 'elevator', hasContacts: true },
  intercom_service: { id: 'intercom_service', title: 'Обслуживание домофона', role: 'Ремонт домофона по договору', icon: 'bell', hasContacts: true },
  municipality: { id: 'municipality', title: 'Администрация города', role: 'Улицы, дороги и освещение за пределами двора', icon: 'landmark', hasContacts: true },
  housing_inspection: { id: 'housing_inspection', title: 'Жилищная инспекция (ГЖИ)', role: 'Сюда жалуются, если управляющая организация не выполняет заявку', icon: 'clipboard', hasContacts: true },
  police: { id: 'police', title: 'Полиция (ГИБДД)', role: 'Нарушения правил остановки и стоянки, перекрытый проезд, посторонние в опасных местах', icon: 'shield', hasContacts: true },
  telecom: { id: 'telecom', title: 'Оператор связи', role: 'Владелец кабелей и услуг связи: интернет, телевидение, телефон. Контакты – в вашем договоре или личном кабинете', icon: 'wifi', hasContacts: false },
  emergency112: { id: 'emergency112', title: 'Служба спасения 112', role: 'Пожар, угроза жизни, обрушение, человек в опасности', icon: 'siren-alert', hasContacts: true },
};

/** Общероссийские номера – одинаковы для всех домов (в отличие от контактов организаций). */
export const NATIONAL_CONTACTS = {
  emergency112: {
    name: 'Единая служба спасения',
    phones: [{ label: 'С любого телефона', number: '112' }],
    hours: 'Круглосуточно',
  },
  police: {
    name: 'Полиция',
    phones: [
      { label: 'С мобильного', number: '102' },
      { label: 'Единая служба спасения', number: '112' },
    ],
    hours: 'Круглосуточно',
    note: 'Нарушения стоянки, которые не угрожают людям, можно передать в ГИБДД через сайт или приложение вашего региона.',
  },
  gas_emergency: {
    name: 'Аварийная газовая служба',
    phones: [
      { label: 'С мобильного', number: '104' },
      { label: 'Единая служба спасения', number: '112' },
    ],
    hours: 'Круглосуточно',
    note: 'При запахе газа звоните не из квартиры, а с лестницы или улицы.',
  },
} as const;
