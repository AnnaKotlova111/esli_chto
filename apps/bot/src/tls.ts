import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { rootCertificates } from 'node:tls';
// Публичный корневой сертификат «Russian Trusted Root CA» (Минцифры), источник:
// https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt
// API MAX (*.max.ru) подписан этим центром; в Node.js и Windows он по умолчанию не считается доверенным.
import russianRootCa from '../../../deploy/russian_trusted_root_ca.pem';

const CA = [...rootCertificates, russianRootCa];

/**
 * fetch для Bot API MAX: доверяет стандартным корневым сертификатам и корневому сертификату Минцифры.
 * Подключается только к клиенту бота (clientOptions.fetch), остальной трафик процесса не затрагивается.
 */
export const maxFetch: typeof globalThis.fetch = (input, init) =>
  new Promise((resolve, reject) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const body = init?.body == null ? undefined : typeof init.body === 'string' ? init.body : Buffer.from(init.body as ArrayBuffer);
    if (body !== undefined && !headers['content-length']) headers['content-length'] = String(Buffer.byteLength(body));

    // Локальные http-адреса (тестовая имитация API) идут без TLS
    const send = url.protocol === 'http:' ? httpRequest : httpsRequest;
    const req = send(
      url,
      { method, headers, ...(url.protocol === 'https:' ? { ca: CA } : {}) },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const h = new Headers();
          for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(', ') : v);
          const noBody = res.statusCode === 204 || res.statusCode === 304;
          resolve(new Response(noBody ? null : Buffer.concat(chunks), { status: res.statusCode ?? 0, statusText: res.statusMessage ?? '', headers: h }));
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    const signal = init?.signal;
    if (signal) {
      if (signal.aborted) return req.destroy(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      // Один сигнал живёт на всё время long polling: обработчик снимаем по завершении запроса, иначе они копятся
      const onAbort = () => req.destroy(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
      req.on('close', () => signal.removeEventListener('abort', onAbort));
    }
    if (body !== undefined) req.write(body);
    req.end();
  });
