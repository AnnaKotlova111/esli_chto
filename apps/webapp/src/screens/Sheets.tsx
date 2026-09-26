import { useCallback, useRef, useState } from 'react';
import {
  APP_META, CITY, PRIVACY, TERMS, getElement, getNorm, getProblem, hasUnsureOption, localizeQuestion, resolve, typo, zoneTitle,
  type LegalDoc,
} from '@esli-chto/core';
import { haptic, openLink } from '../bridge';
import { useApp, type SheetView } from '../state';
import { BottomSheet, ConfirmDialog, type PageDirection } from '../ui/BottomSheet';
import { motionEnabled } from '../ui/gestures';
import { Button } from '../ui/Button';
import { ElementIcon, Icon } from '../ui/icons';
import { BASIS_HINT, BASIS_LABEL, Callout, ListRow, Section, UrgencyBadge } from '../ui/parts';
import { FeaturesEditor, HousesView } from './Houses';
import { RequestView } from './Request';
import { ResultView } from './Result';
import { UrgentView } from './Urgent';

function titleOf(v: SheetView): string {
  switch (v.t) {
    case 'element':
      return getElement(v.id)?.title ?? 'Объект';
    case 'flow':
      return getProblem(v.problemId)?.element.title ?? 'Ситуация';
    case 'norm':
      return 'Норма права';
    case 'request':
      return 'Обращение';
    case 'houses':
      return 'Мой дом';
    case 'features':
      return 'Что есть в доме';
    case 'about':
      return 'О приложении';
    case 'privacy':
      return PRIVACY.title;
    case 'terms':
      return TERMS.title;
    case 'urgent':
      return 'Срочно';
  }
}

/** Глубина экрана: шаги шторки и ответы на уточняющие вопросы – по ней понятно, вперёд или назад. */
const depthOf = (sheet: SheetView[]) => {
  const top = sheet[sheet.length - 1];
  return sheet.length * 100 + (top?.t === 'flow' ? top.answers.length : 0);
};

export function SheetHost() {
  const { state, back, closeAll, confirmLeave, cancelLeave } = useApp();
  const top = state.sheet[state.sheet.length - 1];

  // Направление запоминаем один раз на экран, иначе анимация перезапускалась бы при каждой перерисовке
  const depth = depthOf(state.sheet);
  const contentKey = top ? JSON.stringify(top) : '';
  const nav = useRef({ key: '', depth: 0, dir: 'none' as PageDirection });
  if (top && nav.current.key !== contentKey) {
    const dir: PageDirection = !nav.current.key ? 'none' : depth > nav.current.depth ? 'forward' : depth < nav.current.depth ? 'back' : 'none';
    nav.current = { key: contentKey, depth, dir };
  }

  // Последний экран держим, пока шторка уезжает вниз (без анимаций – закрываем сразу)
  const last = useRef<SheetView | null>(null);
  const [, rerender] = useState(0);
  const onLeft = useCallback(() => {
    last.current = null;
    rerender((n) => n + 1);
  }, []);
  if (top) last.current = top;
  else if (last.current && !motionEnabled()) last.current = null;
  const view = top ?? last.current;
  if (!view) {
    nav.current = { key: '', depth: 0, dir: 'none' };
    return null;
  }
  const leaving = !top;
  // У ситуации «Назад» есть всегда: если она открыта первой (из частых ситуаций, поиска), он возвращает к тому списку
  const canBack = !leaving && (state.sheet.length > 1 || view.t === 'flow');
  return (
    <>
      <BottomSheet
        title={titleOf(view)}
        canBack={canBack}
        onBack={back}
        onClose={closeAll}
        contentKey={leaving ? nav.current.key : contentKey}
        direction={nav.current.dir}
        leaving={leaving}
        onLeft={onLeft}
      >
        <SheetContent view={view} />
      </BottomSheet>
      {state.confirmLeave && (
        <ConfirmDialog
          title="Закрыть обращение?"
          text="Правки в тексте обращения не сохранятся."
          confirm="Закрыть"
          cancel="Остаться"
          onConfirm={confirmLeave}
          onCancel={cancelLeave}
        />
      )}
    </>
  );
}

function SheetContent({ view }: { view: SheetView }) {
  switch (view.t) {
    case 'element':
      return <ElementView id={view.id} />;
    case 'flow':
      return <FlowView problemId={view.problemId} answers={view.answers} />;
    case 'norm':
      return <NormView id={view.id} />;
    case 'request':
      return <RequestView problemId={view.problemId} answers={view.answers} />;
    case 'houses':
      return <HousesView />;
    case 'features':
      return <FeaturesView />;
    case 'about':
      return <AboutView />;
    case 'privacy':
      return <LegalView doc={PRIVACY} />;
    case 'terms':
      return <LegalView doc={TERMS} />;
    case 'urgent':
      return <UrgentView />;
  }
}

// ─────────────────────────── Карточка объекта ───────────────────────────

function ElementView({ id }: { id: string }) {
  const { open } = useApp();
  const el = getElement(id);
  if (!el) return <p className="text">Объект не найден.</p>;
  return (
    <div>
      <div className="el-head">
        <span className="el-head__icon">
          <ElementIcon id={el.id} size={28} />
        </span>
        <div>
          <p className="el-head__where">
            {el.scope === 'house' ? 'Наш дом' : 'Моя квартира'} · {zoneTitle(el.zone)}
          </p>
          <p className="el-head__about">{el.about}</p>
        </div>
      </div>
      <Section title="Что случилось?" hint="Выберите ситуацию – покажем, кто отвечает, куда звонить и что делать.">
        <div className="card-list">
          {el.problems.map((p) => (
            <ListRow key={p.id} title={p.title} badge={<UrgencyBadge urgency={p.urgency} />} onClick={() => open({ t: 'flow', problemId: p.id, answers: [] })} />
          ))}
        </div>
      </Section>
    </div>
  );
}

// ─────────────────────────── Уточняющие вопросы → ответ ───────────────────────────

function FlowView({ problemId, answers }: { problemId: string; answers: number[] }) {
  const { house, replaceTop } = useApp();
  const found = getProblem(problemId);
  if (!found) return <p className="text">Ситуация не найдена.</p>;
  const { element, problem } = found;
  const r = resolve(problem, answers);

  if (r.status === 'outcome') {
    return <ResultView element={element} problem={problem} outcome={r.outcome} answers={answers} />;
  }
  const q = localizeQuestion(r.question, house);
  return (
    <div className="flow">
      <p className="flow__problem">{typo(problem.title)}</p>
      {problem.urgency === 'emergency' && (
        <Callout tone="critical" title="Опасная ситуация" role="alert">
          Если есть угроза жизни, пожар или запах газа – не отвечайте на вопросы, сразу звоните{' '}
          <a href="tel:112">
            <strong>112</strong>
          </a>
          .
        </Callout>
      )}
      <p className="flow__step">Уточнение {answers.length + 1}</p>
      <h3 className="flow__ask">{typo(q.ask)}</h3>
      {q.hint && <p className="flow__hint">{typo(q.hint)}</p>}
      <div className="card-list">
        {q.options.map((o, i) => (
          <ListRow
            key={i}
            title={o.label}
            onClick={() => {
              haptic.selection();
              replaceTop({ t: 'flow', problemId, answers: [...answers, i] });
            }}
          />
        ))}
      </div>
      <p className="fineprint">
        От ответа зависит, где проходит граница ответственности.
        {hasUnsureOption(q) && ' Не уверены – выберите вариант «Не знаю»: подскажем безопасный порядок действий.'}
      </p>
      <p className="sr-only">{element.title}</p>
    </div>
  );
}

// ─────────────────────────── Норма права ───────────────────────────

function NormView({ id }: { id: string }) {
  const n = getNorm(id);
  return (
    <div>
      <h3 className="norm__short">{n.short}</h3>
      <p className="norm__doc">{n.doc}</p>
      <Section title="О чём норма">
        <p className="text">{typo(n.gist)}</p>
        <p className="fineprint">Пересказ своими словами, а не цитата. Точная формулировка – в первоисточнике.</p>
      </Section>
      {n.url && (
        <Button kind="secondary" block icon={<Icon name="external" />} onClick={() => openLink(n.url!)}>
          Открыть первоисточник
        </Button>
      )}
    </div>
  );
}

// ─────────────────────────── Что есть в доме ───────────────────────────

function FeaturesView() {
  const { closeAll } = useApp();
  return (
    <div>
      <FeaturesEditor />
      <Button kind="primary" block icon={<Icon name="success" />} onClick={closeAll}>
        Готово
      </Button>
    </div>
  );
}

// ─────────────────────────── О приложении ───────────────────────────

function AboutView() {
  const { house, open, eraseLocalData, toast } = useApp();
  const [confirmErase, setConfirmErase] = useState(false);
  return (
    <div className="about">
      <div className="about__brand">
        <span className="about__logo" aria-hidden="true">
          <Icon name="urgent" size={28} />
        </span>
        <div>
          <p className="about__name">{APP_META.name}</p>
          <p className="text-secondary">{APP_META.tagline}</p>
        </div>
      </div>

      <Callout tone="info" title={`Данные по г. ${CITY.name}`}>
        Дома и управляющие организации – из открытых источников: {CITY.source.replace(/^Открытые данные: /, '')}. Сведения на {CITY.updatedAt.split('-').reverse().join('.')}. Контакты городских служб – с сайтов организаций и администрации города. Номера 112, 104 и 102 – общероссийские.
      </Callout>

      <Section title="Как принимается решение">
        <p className="text">
          Ответы не генерируются: для каждого объекта и ситуации заранее записано дерево правил со ссылкой на норму. Один и тот же вопрос в одном доме всегда даёт один и тот же ответ.
        </p>
        <dl className="legend">
          {(['norm', 'practice', 'contract'] as const).map((b) => (
            <div key={b} className="legend__row">
              <dt>{BASIS_LABEL[b]}</dt>
              <dd>{BASIS_HINT[b]}</dd>
            </div>
          ))}
        </dl>
        <p className="text-secondary">Нормы сверены с полными текстами документов в действующей редакции на {APP_META.normsCheckedAt}.</p>
      </Section>

      <Section title="Документы">
        <div className="card-list">
          <ListRow icon={<Icon name="privacy" />} title={PRIVACY.title} onClick={() => open({ t: 'privacy' })} />
          <ListRow icon={<Icon name="legal" />} title={TERMS.title} onClick={() => open({ t: 'terms' })} />
        </div>
      </Section>

      <Section title="Ваши данные на устройстве" hint="ФИО, подъезд, квартира, телефон, выбранный дом, история поиска и недавние ситуации хранятся только на этом устройстве.">
        <Button
          kind={confirmErase ? 'critical' : 'secondary'}
          block
          icon={<Icon name="erase" />}
          onClick={() => {
            if (!confirmErase) return setConfirmErase(true);
            eraseLocalData();
            setConfirmErase(false);
            toast('Данные на устройстве удалены');
          }}
        >
          {confirmErase ? 'Нажмите ещё раз, чтобы стереть' : 'Стереть мои данные'}
        </Button>
      </Section>

      <Section title="Сведения">
        <dl className="facts">
          <dt>Версия</dt>
          <dd>{APP_META.version}</dd>
          <dt>Правообладатель и оператор</dt>
          <dd>{APP_META.operator}</dd>
          <dt>Возрастная маркировка</dt>
          <dd>{APP_META.ageRating}</dd>
          <dt>Поддержка</dt>
          <dd>Чат с ботом {APP_META.supportBot}</dd>
          <dt>Текущий дом</dt>
          <dd>{house.id === 'none' ? 'не выбран' : `${house.address}. Данные на ${house.updatedAt.split('-').reverse().join('.')}.`}</dd>
        </dl>
      </Section>

      <p className="fineprint">Справочная информация, не юридическая консультация.</p>
    </div>
  );
}

function LegalView({ doc }: { doc: LegalDoc }) {
  return (
    <div className="legal">
      <p className="text">{doc.intro}</p>
      {doc.sections.map((s) => (
        <Section key={s.heading} title={s.heading}>
          <ul className="bullets">
            {s.items.map((it) => (
              <li key={it}>{it}</li>
            ))}
          </ul>
        </Section>
      ))}
      <p className="fineprint">{doc.edition}</p>
    </div>
  );
}
