/**
 * Интеграционная проверка бота без настоящего токена.
 * Поднимаем имитацию MAX Bot API, запускаем собранный сервер и прогоняем полный цикл
 * «входящее событие → HTTP-запросы бота к API» в двух режимах: long polling и вебхук.
 * Проверяется, что реально уходит в API: тексты, клавиатуры, кнопка мини-приложения с диплинком,
 * подтверждение нажатий, молчание в группах, ограничение частоты и команда /forget,
 * а также устойчивость: недоступный при старте API и зависший запрос не роняют сервер.
 *
 * Запуск: npm run build && npm run test:integration
 */
import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const serverFile = join(here, '..', 'dist', 'server.mjs');
const TOKEN = 'test-token';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readBody = (req) =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data ? JSON.parse(data) : {}));
  });

/** Имитация MAX Bot API: копит отправленные сообщения, отдаёт очередь событий для long polling. */
function createMock(port, { failSubscribe = 0, hangMessages = 0 } = {}) {
  const state = { queue: [], sent: [], answered: [], subscriptions: [], commandsSet: false, marker: 0, failSubscribe, hangMessages };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (obj, code = 200) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
    if (req.headers.authorization !== TOKEN) return json({ code: 'verify.token', message: 'bad token' }, 401);
    if (url.pathname === '/me' && req.method === 'GET') return json({ user_id: 1, first_name: 'Если что', username: 'esli_chto_test_bot', is_bot: true });
    if ((url.pathname === '/me' || url.pathname === '/me/commands') && req.method !== 'GET') {
      state.commandsSet = true;
      return json({ success: true });
    }
    if (url.pathname === '/subscriptions' && req.method === 'GET') return json({ subscriptions: state.subscriptions });
    if (url.pathname === '/subscriptions' && req.method === 'POST') {
      // имитация временной недоступности API при подписке на вебхук
      if (state.failSubscribe > 0) {
        state.failSubscribe -= 1;
        return json({ code: 'internal', message: 'temporarily unavailable' }, 503);
      }
      state.subscriptions.push(await readBody(req));
      return json({ success: true });
    }
    if (url.pathname === '/subscriptions' && req.method === 'DELETE') return json({ success: true });
    if (url.pathname === '/updates') {
      const deadline = Date.now() + 1000;
      while (state.queue.length === 0 && Date.now() < deadline) await sleep(40);
      const batch = state.queue.splice(0);
      state.marker += batch.length;
      return json({ updates: batch, marker: state.marker });
    }
    if (url.pathname === '/messages' && req.method === 'POST') {
      const body = await readBody(req);
      // имитация зависшего API: запрос принят, ответа нет
      if (state.hangMessages > 0) {
        state.hangMessages -= 1;
        return;
      }
      state.sent.push({ query: Object.fromEntries(url.searchParams), body });
      return json({ message: { body: { mid: `m${state.sent.length}`, seq: state.sent.length, text: body.text }, timestamp: Date.now(), recipient: {} } });
    }
    if (url.pathname === '/answers') {
      state.answered.push(await readBody(req));
      return json({ success: true });
    }
    console.error('имитация API: неожиданный запрос', req.method, req.url);
    return json({ code: 'not.found', message: req.url }, 404);
  });
  return { state, start: () => new Promise((r) => server.listen(port, r)), stop: () => server.close() };
}

function startApp(port, env) {
  const child = spawn(process.execPath, [serverFile], {
    env: { ...process.env, PORT: String(port), BOT_TOKEN: TOKEN, PUBLIC_URL: '', WEBHOOK_SECRET: '', WEBAPP_DIST: join(here, '..', '..', 'webapp', 'dist'), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = { log: '' };
  child.stdout.on('data', (d) => (out.log += d));
  child.stderr.on('data', (d) => (out.log += d));
  return { child, out };
}

const waitFor = async (cond, what, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return;
    await sleep(40);
  }
  throw new Error(`Не дождались: ${what}`);
};

// ─────────────── События, как их присылает MAX ───────────────

const userOf = (id) => ({ user_id: id, first_name: 'Житель', is_bot: false, last_activity_time: Date.now() });
const started = (uid, payload) => ({ update_type: 'bot_started', timestamp: Date.now(), chat_id: 100 + uid, user: userOf(uid), payload });
const text = (uid, body, chatType = 'dialog') => ({
  update_type: 'message_created',
  timestamp: Date.now(),
  message: { sender: userOf(uid), recipient: { chat_id: 100 + uid, chat_type: chatType, user_id: 1 }, timestamp: Date.now(), body: { mid: `t${Math.random()}`, seq: 1, text: body } },
});
const tap = (uid, payload) => ({
  update_type: 'message_callback',
  timestamp: Date.now(),
  callback: { timestamp: Date.now(), callback_id: `cb${Math.random()}`, payload, user: userOf(uid) },
  message: { sender: { user_id: 1, is_bot: true }, recipient: { chat_id: 100 + uid, chat_type: 'dialog' }, timestamp: Date.now(), body: { mid: 'b1', seq: 2, text: '' } },
});

const buttons = (msg) => (msg.body.attachments?.find((a) => a.type === 'inline_keyboard')?.payload?.buttons ?? []).flat();

/** Общий сценарий: одинаково проверяется для long polling и для вебхука. */
async function scenario(mock, deliver) {
  const { sent, answered } = mock.state;
  const next = async (update, what) => {
    const before = sent.length;
    await deliver(update);
    await waitFor(() => sent.length > before, `${what} (было ${before}, стало ${sent.length})`);
    return sent[sent.length - 1];
  };

  // 1. «Начать» с диплинком на ситуацию: ответ по той же ситуации и кнопка мини-приложения с тем же диплинком
  const first = await next(started(42, 'h_vch_korovina_11-p_roof__leak'), 'ответ на bot_started');
  assert.equal(first.body.format, 'html', 'сообщения размечены HTML: жирные номера и запреты');
  assert.match(first.body.text, /Крыша/);
  assert.match(first.body.text, /УК «Жилищно-ремонтный участок №1»/);
  assert.match(first.body.text, /открытых данных/);
  assert.ok(buttons(first).some((b) => b.type === 'open_app' && b.web_app === 'esli_chto_test_bot' && b.payload === 'h_vch_korovina_11-p_roof__leak'), 'кнопка «Подробнее в приложении» с диплинком');
  // дом из диплинка запомнился: следующий ответ – с организацией этого дома
  const remembered = await next(tap(42, 'p:lamp_entrance__burned:'), 'ответ после диплинка');
  assert.match(remembered.body.text, /УК «Жилищно-ремонтный участок №1»/, 'дом из диплинка стал домом пользователя');

  // 2. Свободный текст → варианты кнопками
  const found = await next(text(42, 'течёт кран'), 'ответ на свободный текст');
  const cb = buttons(found).find((b) => b.type === 'callback' && b.payload.startsWith('p:tap__leak'));
  assert.ok(cb, 'предложена ситуация «течёт кран»');

  // 3. Нажатие → итоговый ответ, нажатие подтверждено
  const answersBefore = answered.length;
  const result = await next(tap(42, cb.payload), 'ответ на нажатие');
  assert.ok(answered.length > answersBefore, 'нажатие подтверждено через /answers');
  assert.match(result.body.text, /Ваша зона ответственности/);
  assert.match(result.body.text, /<b>Что делать<\/b>\n\n1\. /);

  // 4. Ветвление вопросов: вопрос → вариант → ответ
  const question = await next(tap(42, 'p:pipes_valves__leak:'), 'уточняющий вопрос');
  assert.match(question.body.text, /❓/);
  const options = buttons(question).filter((b) => b.type === 'callback' && b.payload.startsWith('p:pipes_valves__leak:'));
  assert.ok(options.length >= 3, 'варианты ответа кнопками');
  const branch = await next(tap(42, options[1].payload), 'ответ по ветке');
  assert.match(branch.body.text, /Ваша зона ответственности/);

  // 5. Аварийная ситуация сразу называет экстренный номер
  const gas = await next(tap(42, 'p:gas_stove__smell:'), 'запах газа');
  assert.match(gas.body.text, /🆘 <b><u>Опасно: сначала звоните 104<\/u><\/b>/);

  // 6. Мусорное нажатие не роняет бота
  const junk = await next(tap(42, 'DROP TABLE;'), 'ответ на некорректное нажатие');
  assert.match(junk.body.text, /Если что/);

  // 7. Выбор дома: /house → адрес текстом → организация и телефоны дома
  const ask = await next(text(42, '/house'), 'приглашение написать адрес');
  assert.match(ask.body.text, /Напишите адрес своего дома/);
  const chosen = await next(text(42, 'Коровина 11'), 'выбор дома по адресу');
  assert.match(chosen.body.text, /Ваш дом: <b>г\. Вичуга, ул\. Коровина, д\. 11<\/b>/);
  assert.match(chosen.body.text, /Аварийная служба: <b>\+7 \(493\) 542-34-73<\/b>/);
  const after = await next(text(42, 'течёт кран'), 'после выбора дома текст снова ищет ситуацию');
  assert.ok(buttons(after).some((b) => b.type === 'callback' && b.payload.startsWith('p:tap__leak')));

  // 8. Другой дом кнопкой и список всех домов по страницам
  const tszh = await next(tap(42, 'h:vch_pyatnitskiy_13'), 'выбор дома кнопкой');
  assert.match(tszh.body.text, /ТСЖ «Старатели»/);
  const list = await next(text(42, '/houses'), 'список домов');
  assert.match(list.body.text, /Дома справочника \(223\)/);
  assert.ok(buttons(list).some((b) => b.type === 'callback' && /^hl:\d+$/.test(b.payload)), 'листание страниц');
  const lamp = await next(tap(42, 'p:lamp_entrance__burned:'), 'ответ для ТСЖ');
  assert.match(lamp.body.text, /ТСЖ «Старатели»<\/b>\n📞 <b>\+7 \(920\) 377-87-88<\/b>/);

  // 9. /forget – бот забывает выбранный дом
  const forgot = await next(text(42, '/forget'), '/forget');
  assert.match(forgot.body.text, /забыл/);
  const again = await next(tap(42, 'p:lamp_entrance__burned:'), 'ответ после /forget');
  assert.match(again.body.text, /Выберите свой дом командой \/house/);

  // 10. Фото или стикер без текста – подсказка; сообщение от бота (эхо) – без ответа
  const photo = text(45, undefined);
  photo.message.body.attachments = [{ type: 'image', payload: { url: 'https://example.org/p.jpg' } }];
  const hint = await next(photo, 'ответ на сообщение без текста');
  assert.match(hint.body.text, /только текст/);
  const beforeEcho = sent.length;
  const echo = text(45, undefined);
  echo.message.sender = { user_id: 1, is_bot: true };
  await deliver(echo);
  await sleep(600);
  assert.equal(sent.length, beforeEcho, 'на свои сообщения бот не отвечает');

  // 11. В групповом чате бот молчит
  const beforeGroup = sent.length;
  await deliver(text(43, 'течёт кран', 'chat'));
  await sleep(600);
  assert.equal(sent.length, beforeGroup, 'в группе нет ответа');

  // 12. Ограничение частоты: сверх лимита события одного пользователя не обрабатываются
  const beforeFlood = sent.length;
  for (let i = 0; i < 25; i += 1) await deliver(text(44, 'лампочка'));
  await sleep(1500);
  assert.equal(sent.length - beforeFlood, 20, 'обработано ровно RATE_LIMIT_PER_MINUTE сообщений');
}

async function runPolling() {
  const mock = createMock(18081);
  await mock.start();
  const app = startApp(18082, { MAX_API_BASE_URL: 'http://localhost:18081', RATE_LIMIT_PER_MINUTE: '20' });
  try {
    await waitFor(() => app.out.log.includes('long polling mode'), 'запуск в режиме long polling');
    await waitFor(() => mock.state.commandsSet, 'регистрация команд');
    await scenario(mock, async (u) => {
      mock.state.queue.push(u);
    });
    const health = await (await fetch('http://localhost:18082/healthz')).json();
    assert.equal(health.ok, true);
    assert.equal(health.bot, 'polling');
    assert.equal(health.houses, 223);
    const page = await fetch('http://localhost:18082/');
    assert.match(await page.text(), /<title>Если что<\/title>/, 'мини-приложение отдаётся тем же сервером');
    console.log(`OK long polling: сообщений отправлено ${mock.state.sent.length}`);
  } catch (e) {
    console.error(app.out.log);
    throw e;
  } finally {
    app.child.kill('SIGTERM');
    mock.stop();
  }
}

async function runWebhook() {
  const mock = createMock(18083);
  await mock.start();
  const SECRET = 'integration_secret_123';
  const app = startApp(18084, { MAX_API_BASE_URL: 'http://localhost:18083', PUBLIC_URL: 'https://esli-chto.example.org', WEBHOOK_SECRET: SECRET, RATE_LIMIT_PER_MINUTE: '20' });
  const hook = 'http://localhost:18084/max/webhook';
  const post = (update, secret = SECRET) =>
    fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { 'x-max-bot-api-secret': secret } : {}) }, body: JSON.stringify(update) });
  try {
    await waitFor(() => app.out.log.includes('webhook mode'), 'запуск в режиме вебхука');
    await waitFor(() => mock.state.subscriptions.length > 0, 'подписка на вебхук');
    const sub = mock.state.subscriptions[0];
    assert.equal(sub.url, 'https://esli-chto.example.org/max/webhook');
    assert.equal(sub.secret, SECRET, 'секрет передан при подписке');

    // чужие запросы без секрета или с неверным секретом отклоняются и не обрабатываются
    const before = mock.state.sent.length;
    assert.equal((await post(text(42, 'течёт кран'), '')).status, 404);
    assert.equal((await post(text(42, 'течёт кран'), 'wrong_secret_value_000')).status, 404);
    await sleep(300);
    assert.equal(mock.state.sent.length, before, 'поддельные события не обработаны');

    await scenario(mock, async (u) => {
      const r = await post(u);
      assert.equal(r.status, 200);
    });
    const health = await (await fetch('http://localhost:18084/healthz')).json();
    assert.equal(health.bot, 'webhook');
    console.log(`OK webhook: сообщений отправлено ${mock.state.sent.length}`);
  } catch (e) {
    console.error(app.out.log);
    throw e;
  } finally {
    app.child.kill('SIGTERM');
    mock.stop();
  }
}

/** API недоступен при старте, затем зависает на отправке: сервер не падает, мини-приложение работает, бот восстанавливается. */
async function runResilience() {
  const mock = createMock(18086, { failSubscribe: 1, hangMessages: 1 });
  await mock.start();
  const SECRET = 'integration_secret_456';
  const app = startApp(18087, { MAX_API_BASE_URL: 'http://localhost:18086', PUBLIC_URL: 'https://esli-chto.example.org', WEBHOOK_SECRET: SECRET, MAX_API_TIMEOUT_MS: '1500' });
  const health = async () => (await (await fetch('http://localhost:18087/healthz')).json()).bot;
  try {
    await waitFor(() => app.out.log.includes('повтор подключения'), 'сбой подписки на вебхук записан в журнал');
    assert.equal(await health(), 'error', 'в /healthz видно, что бот не подключён');
    const page = await fetch('http://localhost:18087/');
    assert.match(await page.text(), /<title>Если что<\/title>/, 'мини-приложение работает, пока API недоступен');
    await waitFor(() => app.out.log.includes('webhook mode'), 'повторная подписка после паузы', 12000);
    assert.equal(await health(), 'webhook');

    // первый ответ бота зависает в API – по тайм-ауту обработчик завершается и пользователь получает сообщение об ошибке
    const r = await fetch('http://localhost:18087/max/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-max-bot-api-secret': SECRET },
      body: JSON.stringify(text(50, 'течёт кран')),
    });
    assert.equal(r.status, 200);
    await waitFor(() => mock.state.sent.some((m) => /Что-то пошло не так/.test(m.body.text)), 'ответ после тайм-аута API', 6000);
    console.log('OK устойчивость: сбой API при старте и зависший запрос не роняют сервер');
  } catch (e) {
    console.error(app.out.log);
    throw e;
  } finally {
    app.child.kill('SIGTERM');
    mock.stop();
  }
}

async function runWithoutToken() {
  const app = startApp(18085, { BOT_TOKEN: '' });
  try {
    await waitFor(() => app.out.log.includes('http listening'), 'запуск без токена');
    const health = await (await fetch('http://localhost:18085/healthz')).json();
    assert.equal(health.bot, 'disabled', 'без токена бот выключен, мини-приложение работает');
    // попытка выйти за пределы каталога мини-приложения (путь отправляется как есть, без нормализации клиентом)
    const status = await new Promise((resolve, reject) => {
      request({ host: 'localhost', port: 18085, path: '/..%2f..%2fpackage.json' }, (res) => resolve(res.statusCode)).on('error', reject).end();
    });
    assert.equal(status, 403, 'выход за пределы каталога запрещён');
    console.log('OK без токена: мини-приложение и /healthz работают');
  } finally {
    app.child.kill('SIGTERM');
  }
}

try {
  await runPolling();
  await runWebhook();
  await runResilience();
  await runWithoutToken();
  console.log('Интеграционная проверка пройдена.');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(1);
}
