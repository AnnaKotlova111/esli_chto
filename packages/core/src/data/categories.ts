import type { Category } from '../types';

/** Подписи категорий в порядке показа. */
export const CATEGORIES: { id: Category; title: string }[] = [
  { id: 'water', title: 'Вода' },
  { id: 'electricity', title: 'Электричество' },
  { id: 'gas', title: 'Газ' },
  { id: 'heating', title: 'Отопление' },
  { id: 'elevator', title: 'Лифт' },
  { id: 'entrance', title: 'Подъезд' },
  { id: 'trash', title: 'Мусор' },
  { id: 'other', title: 'Другое' },
];

/** Категория объекта. Всё, чего нет в списке, относится к «Другое». */
const BY_ELEMENT: Record<string, Category> = {
  // вода и канализация
  risers: 'water', water_node: 'water', tap: 'water', pipes_valves: 'water', sewer: 'water', riser_flat: 'water',
  toilet: 'water', meter_water: 'water', towel_dryer: 'water', bathtub: 'water', appliances: 'water',
  // электричество
  lamp_entrance: 'electricity', floor_shield: 'electricity', vru: 'electricity', flat_shield: 'electricity',
  meter_electric: 'electricity', outlets: 'electricity', yard_light: 'electricity', utilities: 'electricity',
  // газ
  gas_stove: 'gas', gas_heater: 'gas', gas_meter: 'gas',
  // отопление
  heat_node: 'heating', heat_meter: 'heating', stair_heating: 'heating', radiator: 'heating',
  // лифт
  elevator: 'elevator',
  // подъезд
  door_entrance: 'entrance', intercom: 'entrance', intercom_handset: 'entrance', mailbox: 'entrance', stairs: 'entrance',
  stair_window: 'entrance', stair_walls: 'entrance', fire_safety: 'entrance', telecom_cables: 'entrance',
  // мусор
  trash_area: 'trash', garbage_chute: 'trash',
};

export const categoryOf = (elementId: string): Category => BY_ELEMENT[elementId] ?? 'other';

export const categoryTitle = (c: Category): string => CATEGORIES.find((x) => x.id === c)?.title ?? 'Другое';
