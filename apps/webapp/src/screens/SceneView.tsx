import { useState } from 'react';
import { getElement, isElementAvailable } from '@esli-chto/core';
import { haptic } from '../bridge';
import { getScene, type SceneDef } from '../scenes/scenes';
import { useApp } from '../state';
import { Icon, ElementIcon } from '../ui/icons';
import { SceneMarker } from '../ui/SceneMarker';

type ImageState = 'loading' | 'ok' | 'error';

/**
 * Иллюстрация схемы с кликабельными подписями.
 * Картинка масштабируется по ширине; зоны заданы в процентах, поэтому совпадают с подписями на любом экране.
 */
export function SceneView({ scene }: { scene: SceneDef }) {
  const { house, state, setScene, goToElement } = useApp();
  const [image, setImage] = useState<ImageState>('loading');
  // Крупный режим: схема шире экрана и прокручивается – подписи читаются и нажимаются легче
  const [zoomed, setZoomed] = useState(false);
  const { w, h } = scene.image;

  const activate = (target: string) => {
    if (target.startsWith('portal:')) {
      const next = getScene(target.slice(7));
      if (next) {
        haptic.impact('light');
        setScene(next.tab, next.id);
      }
      return;
    }
    goToElement(target);
  };

  const corner = scene.corner && getElement(scene.corner.target);

  return (
    <figure className="scene" aria-label={`Схема «${scene.title}»`}>
      <div className={zoomed ? 'scene__viewport is-zoomed' : 'scene__viewport'}>
        <div className="scene__canvas" style={{ aspectRatio: `${w} / ${h}` }}>
          <img
            className="scene__img"
            src={scene.image.src}
            width={w}
            height={h}
            alt={`Иллюстрация: ${scene.title}. Подписи объектов нажимаются.`}
            decoding="async"
            onLoad={() => setImage('ok')}
            onError={() => setImage('error')}
            style={image === 'error' ? { visibility: 'hidden' } : undefined}
          />
          {image !== 'ok' && (
            <div className="scene__status" role="status">
              {image === 'loading' ? (
                'Загружаем иллюстрацию…'
              ) : (
                <>
                  <Icon name="notice" />
                  <span>Иллюстрация не загрузилась. Выберите объект в списке «Все объекты» ниже – всё работает и без картинки.</span>
                </>
              )}
            </div>
          )}
          {image !== 'error' &&
            scene.spots.map((s) => {
              const portal = s.target.startsWith('portal:');
              const el = portal ? undefined : getElement(s.target);
              const available = portal || Boolean(el && isElementAvailable(house, el));
              const label = portal ? `Перейти на схему «${getScene(s.target.slice(7))?.title ?? ''}»` : (el?.title ?? s.target);
              return (
                <SceneMarker
                  key={s.target}
                  scene={scene.image}
                  hit={s.hit}
                  plate={s.plate}
                  icon={s.icon}
                  label={label}
                  elementId={el?.id}
                  portal={portal}
                  state={!available ? 'disabled' : state.highlight === s.target ? 'selected' : 'default'}
                  onActivate={() => activate(s.target)}
                />
              );
            })}
          {corner && scene.corner && !zoomed && (
            <button type="button" className="scene__corner" onClick={() => activate(corner.id)} aria-label={`${scene.corner.label}: шум, запахи, залив, перепланировка`}>
              <ElementIcon id={corner.id} size={20} />
              <span>{scene.corner.label}</span>
            </button>
          )}
        </div>
      </div>
      <div className="scene__tools">
        {corner && scene.corner && zoomed && (
          <button type="button" className="scene__tool" onClick={() => activate(corner.id)}>
            <ElementIcon id={corner.id} size={18} /> {scene.corner.label}
          </button>
        )}
        <button type="button" className="scene__tool" aria-pressed={zoomed} onClick={() => setZoomed((z) => !z)}>
          <Icon name={zoomed ? 'zoomOut' : 'zoomIn'} size={18} /> {zoomed ? 'Обычный размер' : 'Крупнее'}
        </button>
      </div>
      <figcaption className="scene__hint">{scene.hint}</figcaption>
    </figure>
  );
}
