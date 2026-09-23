import type { KeyboardEvent } from 'react';
import { ElementIcon, Icon } from './icons';

export type MarkerState = 'default' | 'selected' | 'disabled';

type Box = [number, number, number, number];

interface Props {
  /** Размер иллюстрации в пикселях – от него считаются проценты */
  scene: { w: number; h: number };
  /** Зона нажатия и плашка подписи в пикселях иллюстрации */
  hit: Box;
  plate: Box;
  /** Центр значка на плашке: здесь вырастает активный маркер */
  icon: [number, number, number];
  label: string;
  state: MarkerState;
  /** id объекта – для иконки активного маркера */
  elementId?: string;
  /** Переход на другую схему, а не карточка объекта */
  portal?: boolean;
  onActivate: () => void;
}

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

/**
 * Интерактивная точка на иллюстрации (дизайн-код, разделы 13–14).
 * Подпись и значок нарисованы на самой картинке; компонент накладывает поверх
 * невидимую зону нажатия и рисует состояния: фокус и наведение – синяя обводка,
 * выбран – маркер 40 px, недоступен – приглушение и пометка «нет в доме».
 */
export function SceneMarker({ scene, hit, plate, icon, label, state, elementId, portal, onActivate }: Props) {
  const [hx, hy, hw, hh] = hit;
  const style = { left: pct(hx, scene.w), top: pct(hy, scene.h), width: pct(hw, scene.w), height: pct(hh, scene.h) };
  // плашка и значок – в процентах от зоны нажатия
  const plateStyle = {
    left: pct(plate[0] - hx, hw),
    top: pct(plate[1] - hy, hh),
    width: pct(plate[2], hw),
    height: pct(plate[3], hh),
  };
  const iconStyle = { left: pct(icon[0] - hx, hw), top: pct(icon[1] - hy, hh) };

  if (state === 'disabled') {
    // пометка под плашкой прижимается к ближнему краю картинки, чтобы не обрезаться
    const cx = (plate[0] + plate[2] / 2) / scene.w;
    const align = cx > 0.7 ? 'end' : cx < 0.3 ? 'start' : 'center';
    return (
      <button type="button" className="scene-marker is-disabled" style={style} disabled aria-label={`${label}: нет в этом доме`}>
        <span className="scene-marker__plate" style={plateStyle}>
          <span className={`scene-marker__off scene-marker__off--${align}`}>
            <Icon name="notice" size={14} /> нет в доме
          </span>
        </span>
      </button>
    );
  }

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  };

  return (
    <button
      type="button"
      className={['scene-marker', state === 'selected' ? 'is-selected' : '', portal ? 'is-portal' : ''].join(' ').trim()}
      style={style}
      aria-label={label}
      aria-pressed={portal ? undefined : state === 'selected'}
      onClick={onActivate}
      onKeyDown={onKey}
    >
      <span className="scene-marker__plate" style={plateStyle} aria-hidden="true">
        {portal && (
          <span className="scene-marker__go">
            <Icon name="next" size={16} />
          </span>
        )}
      </span>
      {state === 'selected' && elementId && (
        <span className="scene-marker__dot" style={iconStyle} aria-hidden="true">
          <ElementIcon id={elementId} size={20} />
        </span>
      )}
    </button>
  );
}
