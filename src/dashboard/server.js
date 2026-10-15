const http = require('node:http');
const crypto = require('node:crypto');
const PAGE = require('./page');
const { ensureGuild, getConfig, save } = require('../utils/guildConfig');
const { runAfkCheck, state: afkState } = require('../modules/afk');
const Application = require('../models/Application');
const Ticket = require('../models/Ticket');
const Marriage = require('../models/Marriage');
const UserActivity = require('../models/UserActivity');

// Модуль -> путь булевого флага «включено»
const MODULES = {
  welcome: ['Приветствия', 'welcome.enabled'],
  goodbye: ['Прощания', 'goodbye.enabled'],
  logs: ['Журнал действий', 'logs.enabled'],
  antilink: ['Антилинк', 'security.antilink.enabled'],
  antibot: ['Антибот', 'security.antibot.enabled'],
  anticrash: ['Антикраш', 'security.anticrash.enabled'],
  afk: ['Контроль AFK', 'afk.enabled'],
  tickets: ['Тикеты', 'tickets.enabled'],
};

const safeEq = (a, b) => {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

function startDashboard(client) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return console.log('[dashboard] выключен (задайте DASHBOARD_PASSWORD в .env, чтобы включить)');
  if (password.length < 8) return console.warn('[dashboard] DASHBOARD_PASSWORD короче 8 символов — дашборд не запущен');

  const secret = crypto.createHash('sha256').update(`napakoe:${password}:${process.env.DISCORD_TOKEN}`).digest();
  const sign = (exp) => crypto.createHmac('sha256', secret).update(String(exp)).digest('hex');
  const makeToken = () => {
    const exp = Date.now() + 12 * 3600_000;
    return `${exp}.${sign(exp)}`;
  };
  const isAuthed = (req) => {
    const m = /(?:^|;\s*)nb_session=([^;]+)/.exec(req.headers.cookie ?? '');
    if (!m) return false;
    const [exp, sig] = m[1].split('.');
    return Boolean(exp && sig && Number(exp) > Date.now() && safeEq(sig, sign(exp)));
  };

  const attempts = new Map(); // ip -> { n, t }
  const throttled = (ip) => {
    const now = Date.now();
    const a = attempts.get(ip);
    if (!a || now - a.t > 60_000) return attempts.set(ip, { n: 1, t: now }) && false;
    return ++a.n > 5;
  };

  const send = (res, code, body, headers = {}) => {
    const isStr = typeof body === 'string';
    res.writeHead(code, {
      'Content-Type': isStr ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy':
        "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src https://cdn.discordapp.com data:; connect-src 'self'",
      ...headers,
    });
    res.end(isStr ? body : JSON.stringify(body));
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 10_000) { reject(new Error('too large')); req.destroy(); } else chunks.push(c);
      });
      req.on('end', () => {
        try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('bad json')); }
      });
      req.on('error', reject);
    });

  const guildOr404 = (id) => (/^\d{17,20}$/.test(id) ? client.guilds.cache.get(id) : null);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;

      if (req.method === 'GET' && path === '/') return send(res, 200, PAGE);
      if (!path.startsWith('/api/')) return send(res, 404, { error: 'not found' });

      // CSRF: все POST должны нести кастомный заголовок (его не отправить с чужого сайта без CORS)
      if (req.method === 'POST' && req.headers['x-requested-with'] !== 'napakoe') return send(res, 403, { error: 'forbidden' });

      if (req.method === 'POST' && path === '/api/login') {
        if (throttled(req.socket.remoteAddress)) return send(res, 429, { error: 'Слишком много попыток, подождите минуту' });
        const body = await readBody(req);
        if (!safeEq(body.password ?? '', password)) return send(res, 401, { error: 'Неверный пароль' });
        return send(res, 200, { ok: true }, { 'Set-Cookie': `nb_session=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` });
      }
      if (req.method === 'POST' && path === '/api/logout')
        return send(res, 200, { ok: true }, { 'Set-Cookie': 'nb_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });

      if (!isAuthed(req)) return send(res, 401, { error: 'auth' });

      if (req.method === 'GET' && path === '/api/overview') {
        const guilds = [...client.guilds.cache.values()];
        return send(res, 200, {
          tag: client.user?.tag ?? '—',
          ping: Math.round(client.ws.ping),
          uptime: Math.floor(process.uptime()),
          guilds: guilds.length,
          members: guilds.reduce((n, g) => n + g.memberCount, 0),
          memoryMb: Math.round(process.memoryUsage().rss / 1048576),
          afkLastRun: afkState.lastRun,
          afkRunning: afkState.running,
        });
      }

      if (req.method === 'GET' && path === '/api/guilds') {
        return send(res, 200, [...client.guilds.cache.values()].map((g) => ({
          id: g.id, name: g.name, members: g.memberCount, icon: g.iconURL({ size: 64, extension: 'png' }),
        })));
      }

      const m = /^\/api\/guilds\/(\d+)(\/[a-z/]+)?$/.exec(path);
      if (m) {
        const guild = guildOr404(m[1]);
        if (!guild) return send(res, 404, { error: 'Сервер не найден' });
        const sub = m[2] ?? '';

        if (req.method === 'GET' && sub === '') {
          const id = guild.id;
          const [cfg, pending, openTickets, marriages, afkMembers, tracked] = await Promise.all([
            getConfig(id),
            Application.countDocuments({ guildId: id, status: 'pending' }),
            Ticket.countDocuments({ guildId: id, status: 'open' }),
            Marriage.countDocuments({ guildId: id }),
            UserActivity.countDocuments({ guildId: id, hasAfk: true }),
            UserActivity.countDocuments({ guildId: id }),
          ]);
          const get = (p) => p.split('.').reduce((o, k) => o?.[k], cfg);
          return send(res, 200, {
            id, name: guild.name, members: guild.memberCount,
            modules: Object.entries(MODULES).map(([key, [label, p]]) => ({ key, label, enabled: Boolean(get(p)) })),
            afk: {
              days: cfg.afk.days,
              roleName: guild.roles.cache.get(cfg.afk.roleId)?.name ?? null,
              last: afkState.lastResult?.[id] ?? null,
              lastRun: afkState.lastRun,
            },
            counts: { pending, openTickets, marriages, afkMembers, tracked },
          });
        }

        if (req.method === 'POST' && sub === '/toggle') {
          const { module: key } = await readBody(req);
          const entry = MODULES[key];
          if (!entry) return send(res, 400, { error: 'Неизвестный модуль' });
          const doc = await ensureGuild(guild.id);
          doc.set(entry[1], !doc.get(entry[1]));
          await save(doc);
          return send(res, 200, { ok: true, enabled: Boolean(doc.get(entry[1])) });
        }

        if (req.method === 'POST' && sub === '/afk') {
          const days = Number((await readBody(req)).days);
          if (!Number.isInteger(days) || days < 1 || days > 365) return send(res, 400, { error: 'Срок: целое число от 1 до 365' });
          const doc = await ensureGuild(guild.id);
          doc.set('afk.days', days);
          await save(doc);
          return send(res, 200, { ok: true });
        }

        if (req.method === 'POST' && sub === '/afk/run') {
          const r = await runAfkCheck(client, guild);
          if (r.skipped === true) return send(res, 409, { error: 'Проверка уже выполняется' });
          return send(res, 200, r[guild.id]);
        }
      }
      return send(res, 404, { error: 'not found' });
    } catch (err) {
      console.error('[dashboard]', err.message);
      if (!res.headersSent) send(res, 500, { error: 'Ошибка сервера' });
    }
  });

  const port = Number(process.env.DASHBOARD_PORT) || 3000;
  const host = process.env.DASHBOARD_HOST || '127.0.0.1'; // по умолчанию только локально
  server.on('error', (e) => console.error('[dashboard] не удалось запустить:', e.message));
  server.listen(port, host, () => console.log(`[dashboard] http://${host}:${port}`));
}

module.exports = { startDashboard };
