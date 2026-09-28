import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, statSync, createReadStream } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Bot, Keyboard, type Context } from '@maxhub/max-bot-api';
import { ALL_ELEMENTS, APP_META, DEFAULT_HOUSE_ID, getHouse, HOUSES } from '@esli-chto/core';
import { maxFetch } from './tls';
import {
  addressReply, askAddressReply, elementReply, emergencyReply, help, houseChosenReply, houseFromStart, housesListReply, menuReply,
  nonTextReply, parseCallback, problemReply, startReply, textReply, welcome,
  type ChatButton, type ChatReply,
} from './chat';

// ─────────────────────────── Настройки ───────────────────────────

// Локальный запуск (npm start) читает .env из текущей папки; переменные окружения (Docker, хостинг) важнее файла.
if (existsSync('.env')) process.loadEnvFile('.env');

const env = (k: string): string | undefined => {
  const v = process.env[k]?.trim();
  return v ? v : undefined;
};

const PORT = Number(env('PORT') ?? 8080);
const BOT_TOKEN = env('BOT_TOKEN');
/** Публичный HTTPS-адрес приложения. Если задан – бот работает через вебхук, иначе через long polling. */
const PUBLIC_URL = env('PUBLIC_URL')?.replace(/\/+$/, '');
const WEBHOOK_PATH = env('WEBHOOK_PATH') ?? '/max/webhook';
/**
 * Секрет вебхука: MAX присылает его в заголовке каждого запроса, чужие запросы отклоняются.
 * MAX принимает 5–256 символов [A-Za-z0-9_-]. Если секрет не задан или не подходит по формату,
 * он генерируется при запуске и регистрируется вместе с подпиской.
 */
const WEBHOOK_SECRET_FORMAT = /^[A-Za-z0-9_-]{5,256}$/;
const configuredSecret = env('WEBHOOK_SECRET');
const WEBHOOK_SECRET = configuredSecret && WEBHOOK_SECRET_FORMAT.test(configuredSecret) ? configuredSecret : randomBytes(24).toString('hex');
const WEBAPP_DIST = resolve(env('WEBAPP_DIST') ?? join(process.cwd(), 'apps/webapp/dist'));
/** Сколько событий в минуту обрабатывается от одного пользователя (защита от спама и лимита Bot API – 30 запросов/с). */
const RATE_LIMIT_PER_MINUTE = Math.max(1, Number(env('RATE_LIMIT_PER_MINUTE') ?? 20) || 20);
/** Только для тестов: адрес имитации MAX API. В продакшене не задавать. */
const MAX_API_BASE_URL = env('MAX_API_BASE_URL');
/** Пауза перед повторным подключением к MAX: 5 с, затем вдвое больше, но не больше минуты. */
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;
/** Ник бота для кнопок открытия мини-приложения (иначе берётся из /me). */
let botUsername = env('BOT_USERNAME');

const log = (level: 'info' | 'warn' | 'error', msg: string, extra?: unknown) => {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(extra ? { extra } : {}) });
  (level === 'error' ? console.error : console.log)(line);
};

// ─────────────────────────── Выбор дома по пользователю (в памяти) ───────────────────────────

const houseByUser = new Map<number, string>();
const remember = (userId: number | undefined, houseId: string) => {
  if (userId === undefined) return;
  houseByUser.delete(userId);
  houseByUser.set(userId, houseId);
  if (houseByUser.size > 5000) houseByUser.delete(houseByUser.keys().next().value as number);
};
const hits = new Map<number, number[]>();
/** true – событие можно обработать; иначе пользователь превысил лимит за последнюю минуту. */
const allow = (userId: number | undefined): boolean => {
  if (userId === undefined) return true;
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= RATE_LIMIT_PER_MINUTE) {
    hits.set(userId, recent);
    return false;
  }
  recent.push(now);
  hits.set(userId, recent);
  if (hits.size > 5000) hits.delete(hits.keys().next().value as number);
  return true;
};
/** Пользователи, от которых бот ждёт адрес дома (после /house или кнопки «Сменить дом») */
const awaitingAddress = new Set<number>();
const expectAddress = (userId: number | undefined, on: boolean) => {
  if (userId === undefined) return;
  if (on) awaitingAddress.add(userId);
  else awaitingAddress.delete(userId);
  if (awaitingAddress.size > 5000) awaitingAddress.delete(awaitingAddress.values().next().value as number);
};
/** /forget: удалить всё, что бот хранит о пользователе (выбранный дом, счётчик запросов, ожидание адреса). */
const forget = (userId: number | undefined) => {
  if (userId === undefined) return;
  houseByUser.delete(userId);
  hits.delete(userId);
  awaitingAddress.delete(userId);
};
const houseOf = (userId: number | undefined) => getHouse(userId !== undefined ? houseByUser.get(userId) : DEFAULT_HOUSE_ID);

// ─────────────────────────── Бот ───────────────────────────

function toKeyboard(buttons: ChatButton[][]) {
  return Keyboard.inlineKeyboard(
    buttons.map((row) =>
      row.map((b) =>
        b.kind === 'cb'
          ? Keyboard.button.callback(b.text, b.payload)
          : // без ника открыть мини-приложение нельзя – заменяем на callback «меню»
            botUsername
            ? Keyboard.button.openApp(b.text, botUsername, undefined, b.payload)
            : Keyboard.button.callback('🔎 Другая ситуация', 'menu'),
      ),
    ),
  );
}

/** id пользователя из любого типа события */
const userIdOf = (ctx: Context): number | undefined => {
  const u = ctx.update as unknown as { user?: { user_id?: number }; callback?: { user?: { user_id?: number } }; message?: { sender?: { user_id?: number } | null } };
  return u.user?.user_id ?? u.callback?.user?.user_id ?? u.message?.sender?.user_id ?? undefined;
};

async function send(ctx: Context, reply: ChatReply) {
  await ctx.reply(reply.text, { format: 'html', attachments: [toKeyboard(reply.buttons)] });
}

/** Адрес от пользователя: один дом – запоминаем, несколько – просим уточнить, ни одного – просим ещё раз. */
async function chooseHouse(ctx: Context, uid: number | undefined, text: string) {
  const r = addressReply(text);
  if (r.houseId) {
    remember(uid, r.houseId);
    expectAddress(uid, false);
    return send(ctx, houseChosenReply(getHouse(r.houseId)));
  }
  expectAddress(uid, true);
  return send(ctx, r.reply!);
}

function createBot(token: string): Bot {
  const bot = new Bot(token, { clientOptions: { fetch: maxFetch, ...(MAX_API_BASE_URL ? { baseUrl: MAX_API_BASE_URL } : {}) } });

  bot.catch((err, ctx) => {
    log('error', 'handler failed', { err: String(err), updateType: ctx?.updateType });
    // Не оставляем пользователя без ответа
    void ctx?.reply?.('Что-то пошло не так. Попробуйте ещё раз или откройте карту дома в мини-приложении.').catch(() => undefined);
  });

  void bot.api.setMyCommands([
    { name: 'start', description: 'Начать' },
    { name: 'urgent', description: 'Срочно: газ, потоп, пожар' },
    { name: 'house', description: 'Сменить дом' },
    { name: 'houses', description: 'Список всех домов' },
    { name: 'help', description: 'Как пользоваться' },
    { name: 'forget', description: 'Удалить мои данные в боте' },
  ]).catch((e) => log('warn', 'setMyCommands failed', String(e)));

  // Общие правила для всех событий: в групповых чатах бот молчит, частые запросы одного пользователя отбрасываются
  bot.use(async (ctx, next) => {
    const chatType = (ctx.update as { message?: { recipient?: { chat_type?: string } } }).message?.recipient?.chat_type;
    if (chatType && chatType !== 'dialog') return;
    if (!allow(userIdOf(ctx))) {
      if (ctx.updateType === 'message_callback') await ctx.answerOnCallback({}).catch(() => undefined);
      return;
    }
    await next();
  });

  bot.on('bot_started', async (ctx) => {
    const uid = userIdOf(ctx);
    // дом из диплинка становится домом пользователя – следующие ответы придут с телефонами его организации
    const linkHouse = houseFromStart(ctx.startPayload);
    if (linkHouse) {
      remember(uid, linkHouse);
      expectAddress(uid, false);
    }
    await send(ctx, startReply(ctx.startPayload, houseOf(uid)));
  });

  bot.command('start', async (ctx) => {
    await send(ctx, welcome(houseOf(userIdOf(ctx))));
  });
  bot.command('help', async (ctx) => send(ctx, help(houseOf(userIdOf(ctx)))));
  bot.command('urgent', async (ctx) => send(ctx, emergencyReply(houseOf(userIdOf(ctx)))));
  bot.command('forget', async (ctx) => {
    forget(userIdOf(ctx));
    await ctx.reply('Готово: бот забыл выбранный вами дом. Тексты сообщений бот не хранит.');
  });
  bot.command('house', async (ctx) => {
    const uid = userIdOf(ctx);
    // адрес можно написать сразу после команды: «/house Коровина 11»
    const rest = ctx.message?.body?.text?.replace(/^\/house(@\S+)?\s*/i, '').trim();
    if (rest) return chooseHouse(ctx, uid, rest);
    expectAddress(uid, true);
    await send(ctx, askAddressReply(houseOf(uid)));
  });
  bot.command('houses', async (ctx) => send(ctx, housesListReply(houseOf(userIdOf(ctx)).id)));

  // Нажатия на кнопки
  bot.on('message_callback', async (ctx) => {
    const uid = userIdOf(ctx);
    const action = parseCallback(ctx.callback?.payload);
    // MAX ждёт ответ на callback – подтверждаем сразу, чтобы кнопка не «зависала»
    await ctx.answerOnCallback({}).catch(() => undefined);
    if (!action) return void (await send(ctx, welcome(houseOf(uid))));
    let house = houseOf(uid);
    switch (action.t) {
      case 'house':
        remember(uid, action.houseId);
        expectAddress(uid, false);
        house = getHouse(action.houseId);
        return void (await send(ctx, houseChosenReply(house)));
      case 'houses':
        expectAddress(uid, true);
        return void (await send(ctx, askAddressReply(house)));
      case 'housesPage':
        return void (await send(ctx, housesListReply(house.id, action.page)));
      case 'urgent':
        return void (await send(ctx, emergencyReply(house)));
      case 'menu':
        expectAddress(uid, false);
        return void (await send(ctx, menuReply()));
      case 'element':
        return void (await send(ctx, elementReply(action.elementId, house)));
      case 'problem':
        return void (await send(ctx, problemReply(action.problemId, action.answers, house)));
    }
  });

  // Свободный текст: приветствие – рассказ о боте, описание поломки – поиск ситуации (команды обрабатываются выше)
  bot.on('message_created', async (ctx) => {
    if (ctx.message?.sender?.is_bot) return;
    const uid = userIdOf(ctx);
    const text = ctx.message?.body?.text?.trim();
    if (!text) return send(ctx, nonTextReply(houseOf(uid)));
    if (text.startsWith('/')) return;
    if (uid !== undefined && awaitingAddress.has(uid)) return chooseHouse(ctx, uid, text.slice(0, 120));
    await send(ctx, textReply(text.slice(0, 200), houseOf(uid)));
  });

  return bot;
}

// ─────────────────────────── Статика мини-приложения ───────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  const abs = normalize(join(WEBAPP_DIST, rel));
  // защита от выхода за пределы каталога
  if (abs !== WEBAPP_DIST && !abs.startsWith(WEBAPP_DIST + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  let file = abs;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // SPA: неизвестные пути без расширения отдают index.html
    if (extname(rel)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    file = join(WEBAPP_DIST, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }).end('Мини-приложение не собрано: выполните npm run build');
      return;
    }
  }
  const ext = extname(file);
  const immutable = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  if (req.method === 'HEAD') return void res.end();
  createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

// ─────────────────────────── Запуск ───────────────────────────

async function main() {
  let bot: Bot | undefined;
  /** error – MAX Bot API недоступен, сервер повторяет подключение; мини-приложение при этом работает. */
  let mode: 'disabled' | 'connecting' | 'polling' | 'webhook' | 'error' = 'disabled';
  let webhookHandler: ((req: IncomingMessage, res: ServerResponse) => void) | undefined;
  let retryTimer: NodeJS.Timeout | undefined;
  let stopping = false;

  if (BOT_TOKEN) {
    bot = createBot(BOT_TOKEN);
    mode = 'connecting';
  } else {
    log('warn', 'BOT_TOKEN не задан: запущено только мини-приложение (бот отключён)');
  }

  /**
   * Подключение к MAX. Сбой API при старте (сеть, 5xx, неверный токен) не роняет процесс:
   * мини-приложение продолжает работать, /healthz показывает bot: "error", подключение повторяется.
   */
  const connect = async (b: Bot, attempt = 1): Promise<void> => {
    const retry = (e: unknown) => {
      if (stopping) return;
      mode = 'error';
      const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempt - 1));
      log('error', 'MAX Bot API недоступен (проверьте BOT_TOKEN и сеть), повтор подключения', { err: String(e), attempt, retryInSec: delay / 1000 });
      retryTimer = setTimeout(() => void connect(b, attempt + 1), delay);
    };
    try {
      if (!botUsername) {
        const info = await b.api.getMyInfo();
        botUsername = (info as { username?: string | null }).username ?? undefined;
        log('info', 'bot identity', { username: botUsername });
      }
      if (PUBLIC_URL) {
        webhookHandler = await b.createWebhook({ domain: PUBLIC_URL, path: WEBHOOK_PATH, secret: WEBHOOK_SECRET });
        mode = 'webhook';
        log('info', 'webhook mode', { url: `${PUBLIC_URL}${WEBHOOK_PATH}` });
      } else {
        mode = 'polling';
        log('info', 'long polling mode (только для разработки)');
        // start() отклоняется только при сбое на старте; ошибки во время опроса библиотека повторяет сама
        void b.start().catch(retry);
      }
    } catch (e) {
      retry(e);
    }
  };

  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(
        JSON.stringify({
          ok: true,
          app: APP_META.name,
          version: APP_META.version,
          bot: mode,
          houses: HOUSES.length,
          elements: ALL_ELEMENTS.length,
          situations: ALL_ELEMENTS.reduce((n, e) => n + e.problems.length, 0),
        }),
      );
      return;
    }
    if (webhookHandler && req.method === 'POST' && path === WEBHOOK_PATH) {
      webhookHandler(req, res);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    serveStatic(req, res);
  });
  server.listen(PORT, '0.0.0.0', () => log('info', 'http listening', { port: PORT, webapp: WEBAPP_DIST }));

  if (bot) {
    if (PUBLIC_URL) {
      if (!configuredSecret) log('info', 'WEBHOOK_SECRET не задан: секрет сгенерирован при запуске');
      else if (configuredSecret !== WEBHOOK_SECRET) {
        log('warn', 'WEBHOOK_SECRET не подходит по формату (5–256 символов: латиница, цифры, _ и -): секрет сгенерирован при запуске');
      }
      if (!PUBLIC_URL.startsWith('https://')) log('warn', 'PUBLIC_URL должен быть https:// – MAX принимает вебхуки только по HTTPS');
    }
    await connect(bot);
  }

  const stop = async (signal: string) => {
    log('info', 'shutting down', { signal });
    stopping = true;
    clearTimeout(retryTimer);
    try {
      if (bot) mode === 'webhook' ? await bot.stopWebhook() : bot.stopPolling();
    } catch {
      /* ignore */
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
}

process.on('unhandledRejection', (e) => log('error', 'unhandledRejection', String(e)));
main().catch((e) => {
  log('error', 'fatal', String(e));
  process.exit(1);
});

