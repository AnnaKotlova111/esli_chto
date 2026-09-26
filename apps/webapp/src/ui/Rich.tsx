import { Fragment } from 'react';
import { emphasize, typo } from '@esli-chto/core';

/** Текст с выделенными номерами телефонов и запретами («Не заходите…») – как в ответах бота. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {emphasize(text).map((p, i) => (p.strong ? <strong key={i}>{typo(p.text)}</strong> : <Fragment key={i}>{typo(p.text)}</Fragment>))}
    </>
  );
}
