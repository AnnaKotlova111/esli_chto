/**
 * Все иконки приложения в одном месте.
 *
 * Единая линейная система (набор Lucide, лицензия ISC): контур 2 px, базовый размер 24 × 24.
 * Компоненты используют только семантические имена отсюда – так иконка одного смысла
 * везде одинакова, а замена набора затрагивает один файл.
 */
import type { LucideIcon, LucideProps } from 'lucide-react';
import {
  AirVent, AppWindow, ArrowRight, ArrowUpDown, Bath, BellRing, Blinds, Blocks, BookOpen, BrickWall, Building, Cable,
  ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, CircleQuestionMark, ClipboardList, Clock, Construction,
  Contact, CookingPot, Copy, DoorClosed, DoorClosedLocked, DoorOpen, DoorStairwell, Droplet, Droplets, Ellipsis,
  ExternalLink, Fan, Fence, FileText, FireExtinguisher, Flame, Gauge, Globe, Headset, Heater, House, Info, Lamp, LampCeiling,
  Landmark, Layers, ListChecks, Lock, Mail, Mailbox, MapPin, OctagonAlert, PaintRoller, PanelTop, Pencil, Phone, Plug,
  PlugZap, Receipt, Recycle, Router, Rows3, Scale, Search, Send, Share2, Shield, ShieldAlert, Shovel, Siren, Sofa,
  SquareParking, Thermometer, Toilet, Trash, TreeDeciduous, TriangleAlert, Truck, Users, UtilityPole, Warehouse,
  WashingMachine, WavesArrowDown, WavesVertical, Wifi, Wrench, X, Zap, ZoomIn, ZoomOut,
} from 'lucide-react';

/** Интерфейс: действия, навигация, состояния. */
export const UI_ICONS = {
  search: Search,
  close: X,
  back: ChevronLeft,
  forward: ChevronRight,
  expand: ChevronDown,
  next: ArrowRight,
  info: Info,
  help: CircleQuestionMark,
  call: Phone,
  share: Share2,
  copy: Copy,
  edit: Pencil,
  send: Send,
  contact: Contact,
  request: FileText,
  norm: BookOpen,
  external: ExternalLink,
  steps: ListChecks,
  hours: Clock,
  email: Mail,
  site: Globe,
  location: MapPin,
  legal: Scale,
  privacy: Lock,
  erase: Trash,
  layers: Layers,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  // состояния
  danger: OctagonAlert,
  warning: TriangleAlert,
  notice: CircleAlert,
  success: CircleCheck,
  // навигация
  tabHouse: Building,
  tabFlat: Sofa,
  urgent: Siren,
} satisfies Record<string, LucideIcon>;

/** Категории проблем (дизайн-код, раздел 17). */
export const CATEGORY_ICONS = {
  water: Droplets,
  electricity: Zap,
  gas: Flame,
  heating: Thermometer,
  elevator: ArrowUpDown,
  entrance: DoorStairwell,
  trash: Trash,
  other: Ellipsis,
} satisfies Record<string, LucideIcon>;

/** Стороны ответственности: ключи совпадают с полем icon в packages/core/src/data/parties.ts. */
export const PARTY_ICONS = {
  building: Building,
  siren: Headset,
  home: House,
  users: Users,
  droplets: Droplets,
  thermometer: Thermometer,
  zap: Zap,
  wrench: Wrench,
  flame: Flame,
  truck: Truck,
  elevator: ArrowUpDown,
  bell: BellRing,
  landmark: Landmark,
  clipboard: ClipboardList,
  shield: Shield,
  wifi: Wifi,
  'siren-alert': ShieldAlert,
} satisfies Record<string, LucideIcon>;

/** Объекты на схемах: ключ – id объекта из packages/core. */
export const ELEMENT_ICONS = {
  // двор и фасад
  roof: House,
  facade: BrickWall,
  facade_windows: AppWindow,
  yard: Shovel,
  trees: TreeDeciduous,
  trash_area: Trash,
  playground: Blocks,
  yard_light: Lamp,
  parking: SquareParking,
  utilities: UtilityPole,
  yard_gate: Construction,
  // подъезд
  lamp_entrance: LampCeiling,
  door_entrance: DoorClosed,
  intercom: BellRing,
  mailbox: Mailbox,
  stairs: DoorStairwell,
  elevator: ArrowUpDown,
  garbage_chute: Recycle,
  floor_shield: Zap,
  stair_window: AppWindow,
  stair_walls: PaintRoller,
  fire_safety: FireExtinguisher,
  telecom_cables: Cable,
  stair_heating: Heater,
  // подвал и сети
  basement: Warehouse,
  heat_node: Flame,
  water_node: Droplets,
  vru: PlugZap,
  risers: WavesVertical,
  heat_meter: Thermometer,
  // квартира
  front_door: DoorClosedLocked,
  flat_shield: Zap,
  meter_electric: Gauge,
  intercom_handset: Phone,
  tap: Droplet,
  pipes_valves: Wrench,
  sewer: WavesArrowDown,
  flat_vent: Fan,
  gas_stove: CookingPot,
  outlets: Plug,
  radiator: Heater,
  window: Blinds,
  ceiling: PanelTop,
  riser_flat: WavesVertical,
  toilet: Toilet,
  meter_water: Gauge,
  towel_dryer: Rows3,
  balcony: Fence,
  neighbors: Users,
  floor_walls: BrickWall,
  appliances: WashingMachine,
  aircon: AirVent,
  bathtub: Bath,
  interior_doors: DoorOpen,
  telecom_flat: Router,
  gas_heater: Flame,
  gas_meter: Gauge,
  bill: Receipt,
} satisfies Record<string, LucideIcon>;

export type UiIconName = keyof typeof UI_ICONS;

const FALLBACK = CircleQuestionMark;

/** Иконка интерфейса по семантическому имени. Всегда декоративная: смысл передаёт соседний текст. */
export function Icon({ name, size = 24, ...rest }: { name: UiIconName } & LucideProps) {
  const C = UI_ICONS[name];
  return <C size={size} strokeWidth={2} aria-hidden="true" focusable="false" {...rest} />;
}

const pick = (table: Record<string, LucideIcon>, key: string | undefined) => (key && table[key]) || FALLBACK;

export const ElementIcon = ({ id, size = 24, ...rest }: { id: string } & LucideProps) => {
  const C = pick(ELEMENT_ICONS, id);
  return <C size={size} strokeWidth={2} aria-hidden="true" focusable="false" {...rest} />;
};

export const PartyIcon = ({ icon, size = 24, ...rest }: { icon: string } & LucideProps) => {
  const C = pick(PARTY_ICONS, icon);
  return <C size={size} strokeWidth={2} aria-hidden="true" focusable="false" {...rest} />;
};

export const CategoryIcon = ({ id, size = 24, ...rest }: { id: string } & LucideProps) => {
  const C = pick(CATEGORY_ICONS, id);
  return <C size={size} strokeWidth={2} aria-hidden="true" focusable="false" {...rest} />;
};
