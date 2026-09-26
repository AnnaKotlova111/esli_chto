import { useEffect, useMemo, useRef, useState } from 'react';
import {
  REQUEST_TITLES, USER_FIELD_MAX, blanksOf, buildRequest, collectOutcomes, getProblem, localizeOutcome, phoneHint, resolve,
  type Outcome, type RequestKind, type UserInfo,
} from '@esli-chto/core';
import { Input, Textarea } from '@maxhub/max-ui';
import { copyText, haptic, requestPhone, shareText } from '../bridge';
import { useApp } from '../state';
import { Button } from '../ui/Button';
import { Icon } from '../ui/icons';
import { Callout, Chip, Section } from '../ui/parts';

const KINDS: RequestKind[] = ['repair', 'clarify', 'act', 'recalc'];

/** «В тексте остались места (6) в квадратных скобках: [ФИО], [номер], [дата, время] и др.» */
function blanksMessage(blanks: string[]): string {
  const unique = [...new Set(blanks)];
  const count = blanks.length === 1 ? 'осталось место' : `остались места (${blanks.length})`;
  const list = `${unique.slice(0, 3).join(', ')}${unique.length > 3 ? ' и другие' : ''}`;
  return `В тексте ${count} в квадратных скобках: ${list}. Без них организации будет сложнее принять обращение.`;
}

/** Конструктор обращения: готовый черновик с подставленными данными дома, организации и даты. */
export function RequestView({ problemId, answers }: { problemId: string; answers: number[] }) {
  const { house, state, setUser, toast, setDraftDirty } = useApp();
  const found = getProblem(problemId);
  const [kind, setKind] = useState<RequestKind | null>(null);
  const [edited, setEdited] = useState<string | null>(null);
  /** Перед отправкой в тексте остались [незаполненные места] – ждём решения жителя */
  const [blanksWarning, setBlanksWarning] = useState<string[] | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const flatRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const user = state.user;

  const outcome: Outcome | undefined = useMemo(() => {
    if (!found) return undefined;
    const r = resolve(found.problem, answers);
    return r.status === 'outcome' ? r.outcome : collectOutcomes(found.problem)[0];
  }, [found, answers]);

  const activeKind: RequestKind = kind ?? outcome?.request ?? 'repair';

  const generated = useMemo(() => {
    if (!found || !outcome) return '';
    return buildRequest(activeKind, localizeOutcome(outcome, house), house, { element: found.element, problem: found.problem, user }).body;
  }, [found, outcome, activeKind, house, user]);

  // Ручные правки текста – несохранённый черновик: при закрытии спросим подтверждение
  useEffect(() => {
    setDraftDirty(edited !== null && edited !== generated);
  }, [edited, generated, setDraftDirty]);
  useEffect(() => () => setDraftDirty(false), [setDraftDirty]);

  if (!found || !outcome) return <p className="text">Не удалось подготовить обращение.</p>;

  const text = edited ?? generated;
  const set = (patch: Partial<UserInfo>) => {
    setBlanksWarning(null);
    setUser({ ...user, ...patch });
  };
  const phoneProblem = phoneHint(user.phone);

  const pickPhone = async () => {
    const r = await requestPhone();
    if (r.phone) {
      set({ phone: r.phone });
      haptic.notify('success');
      toast('Номер подставлен из профиля MAX');
    } else if (r.refused) {
      toast('Вы не поделились номером – введите его вручную');
    } else {
      toast('Номер из MAX недоступен – введите его вручную');
    }
  };

  const share = async () => {
    setBlanksWarning(null);
    const r = await shareText(text);
    if (r === 'shared') {
      haptic.notify('success');
      toast('Готово: текст отправлен');
      setEdited(null);
    } else {
      toast(r === 'copied' ? 'Текст скопирован – вставьте его в чат' : 'Не получилось поделиться');
    }
  };

  /** «Отправить в чат»: если остались [незаполненные места] – сначала предупреждаем. */
  const send = () => {
    const blanks = blanksOf(text);
    if (blanks.length === 0) return void share();
    haptic.notify('warning');
    setBlanksWarning(blanks);
  };

  /** «Заполнить»: пустое поле формы, а если текст уже правили вручную – первое место в [скобках] прямо в тексте. */
  const fill = () => {
    setBlanksWarning(null);
    const field = edited !== null ? null : !user.name?.trim() ? nameRef : !user.flat?.trim() ? flatRef : !user.phone?.trim() ? phoneRef : null;
    const target = field?.current;
    if (target) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.focus({ preventScroll: true });
      return;
    }
    const area = textRef.current;
    if (!area) return;
    const first = blanksOf(area.value)[0];
    const start = first ? area.value.indexOf(first) : -1;
    area.scrollIntoView({ block: 'center', behavior: 'smooth' });
    area.focus({ preventScroll: true });
    if (start >= 0) area.setSelectionRange(start, start + first!.length);
  };

  const copy = async () => {
    const ok = await copyText(text);
    if (ok) haptic.notify('success');
    toast(ok ? 'Текст скопирован' : 'Не удалось скопировать – выделите текст вручную');
  };

  return (
    <div className="request">
      <Callout tone="info" icon="privacy">
        Данные для обращения хранятся только на этом устройстве и никуда не отправляются. Кому передать текст – решаете вы.
      </Callout>

      <Section title="Вид обращения">
        <div className="chips chips--wrap" role="radiogroup" aria-label="Вид обращения">
          {KINDS.map((k) => (
            <Chip
              key={k}
              active={k === activeKind}
              onClick={() => {
                setKind(k);
                setEdited(null);
              }}
            >
              {REQUEST_TITLES[k]}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Ваши данные" hint="Подставятся в текст. Можно не заполнять – останутся поля в квадратных скобках.">
        <div className="form">
          <label className="field">
            <span className="field__label">ФИО</span>
            <Input ref={nameRef} value={user.name ?? ''} onChange={(e) => set({ name: e.target.value })} maxLength={USER_FIELD_MAX.name} autoComplete="name" placeholder="Иванов Иван Иванович" />
          </label>
          <div className="form__row">
            <label className="field">
              <span className="field__label">Подъезд</span>
              <Input value={user.entrance ?? ''} onChange={(e) => set({ entrance: e.target.value })} maxLength={USER_FIELD_MAX.entrance} inputMode="numeric" placeholder="2" />
            </label>
            <label className="field">
              <span className="field__label">Квартира</span>
              <Input ref={flatRef} value={user.flat ?? ''} onChange={(e) => set({ flat: e.target.value })} maxLength={USER_FIELD_MAX.flat} inputMode="numeric" placeholder="42" />
            </label>
          </div>
          <label className="field">
            <span className="field__label">Телефон</span>
            <Input
              ref={phoneRef}
              value={user.phone ?? ''}
              onChange={(e) => set({ phone: e.target.value })}
              maxLength={USER_FIELD_MAX.phone}
              inputMode="tel"
              autoComplete="tel"
              placeholder="+7 900 000-00-00"
              aria-invalid={phoneProblem ? true : undefined}
              aria-describedby={phoneProblem ? 'request-phone-hint' : undefined}
            />
            {phoneProblem && (
              <span className="field__hint" id="request-phone-hint" role="status">
                {phoneProblem}
              </span>
            )}
          </label>
          <Button kind="secondary" block icon={<Icon name="contact" />} onClick={pickPhone}>
            Подставить номер из MAX
          </Button>
        </div>
      </Section>

      <Section title="Текст обращения" hint="Замените фразы в [квадратных скобках] и при необходимости поправьте текст.">
        <Textarea
          ref={textRef}
          className="request__text"
          value={text}
          onChange={(e) => {
            setBlanksWarning(null);
            setEdited(e.target.value);
          }}
          rows={14}
          aria-label="Текст обращения"
        />
        {edited !== null && (
          <button type="button" className="link-btn" onClick={() => setEdited(null)}>
            <Icon name="erase" size={18} /> Сбросить правки
          </button>
        )}
      </Section>

      {blanksWarning && (
        <div className="request__blanks">
          <Callout tone="warning" title="Остались незаполненные поля" role="alert">
            {blanksMessage(blanksWarning)}
          </Callout>
          <div className="stack">
            <Button kind="primary" block onClick={fill}>
              Заполнить
            </Button>
            <Button kind="secondary" block onClick={() => void share()}>
              Отправить всё равно
            </Button>
          </div>
        </div>
      )}

      <div className="stack">
        <Button kind="primary" block icon={<Icon name="send" />} onClick={send}>
          Отправить в чат
        </Button>
        <Button kind="secondary" block icon={<Icon name="copy" />} onClick={copy}>
          Скопировать
        </Button>
      </div>

      <p className="fineprint">
        Это шаблон, а не юридический документ. Подайте обращение письменно (или через личный кабинет и ГИС ЖКХ) и сохраните свой экземпляр с отметкой о приёме.
      </p>
    </div>
  );
}
