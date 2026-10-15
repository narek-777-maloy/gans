const { COLOR, FOOTER } = require('../config');
const {
  ActionRowBuilder, StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder,
  ChannelType, PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const { ensureGuild, save } = require('../utils/guildConfig');
const { buildTemplateEmbed } = require('../utils/embeds');

const TEXT = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const EPHEMERAL = MessageFlags.Ephemeral;

/* ---------- Декларативное описание модулей панели ----------
   path     — путь в документе Guild
   toggles  — кнопки-переключатели булевых полей
   selects  — выпадающие списки (channel / role / events)
   modals   — формы редактирования (поля парсятся по type)             */
const EVENTS = [
  { key: 'messageDelete', label: 'Удаление сообщений' },
  { key: 'messageUpdate', label: 'Изменение сообщений' },
  { key: 'roles', label: 'Роли' },
  { key: 'ban', label: 'Баны / разбаны' },
  { key: 'kick', label: 'Кики' },
  { key: 'leave', label: 'Выходы' },
  { key: 'channels', label: 'Каналы' },
];

const embedFields = [
  { key: 'title', label: 'Заголовок', max: 256, required: true },
  { key: 'description', label: 'Описание: {user} {server} {count}', style: 'paragraph', max: 2000, required: true },
  { key: 'color', label: 'Цвет (HEX, например #5865F2)', type: 'hex', max: 7, required: true },
  { key: 'banner', label: 'URL баннера (необязательно)', type: 'url', max: 500 },
  { key: 'footer', label: 'Футер (необязательно)', max: 200 },
];
const embedModule = (title, emoji, path) => ({
  title, emoji, path, preview: true,
  desc: 'Embed с переменными `{user}` `{server}` `{count}`.',
  toggles: [{ key: 'enabled', label: 'Включено' }],
  selects: [{ field: 'channelId', kind: 'channel', placeholder: 'Канал отправки', types: TEXT }],
  modals: [{ id: 'embed', label: 'Настроить Embed', title: `Embed: ${title}`, fields: embedFields }],
});

const MODULES = {
  welcome: embedModule('Приветствие', '👋', 'welcome'),
  goodbye: embedModule('Прощание', '🚪', 'goodbye'),
  logs: {
    title: 'Журнал действий', emoji: '📜', path: 'logs',
    desc: 'Удаление/изменение сообщений, роли, баны, кики, выходы, каналы.',
    toggles: [{ key: 'enabled', label: 'Включено' }],
    selects: [
      { field: 'channelId', kind: 'channel', placeholder: 'Канал журнала', types: TEXT },
      { kind: 'events' },
    ],
  },
  antilink: {
    title: 'Антилинк', emoji: '🔗', path: 'security.antilink',
    desc: 'Удаляет инвайты Discord (и, по желанию, любые ссылки). Админы всегда в белом списке.',
    toggles: [{ key: 'enabled', label: 'Включено' }, { key: 'blockAll', label: 'Все ссылки' }],
    selects: [
      { field: 'whitelistRoles', kind: 'role', multi: true, placeholder: 'Белый список ролей' },
      { field: 'whitelistChannels', kind: 'channel', multi: true, placeholder: 'Белый список каналов/категорий', types: [...TEXT, ChannelType.GuildVoice, ChannelType.GuildCategory] },
    ],
  },
  antibot: {
    title: 'Антибот', emoji: '🤖', path: 'security.antibot',
    desc: 'Выгоняет ботов, которых нет в белом списке ID.',
    toggles: [{ key: 'enabled', label: 'Включено' }],
    selects: [],
    modals: [{ id: 'wl', label: 'Белый список ботов', title: 'Белый список ботов', fields: [
      { key: 'whitelist', label: 'ID ботов (через пробел/запятую)', type: 'list', style: 'paragraph', max: 1000 },
    ] }],
  },
  anticrash: {
    title: 'Антикраш', emoji: '🛡️', path: 'security.anticrash',
    desc: 'Наказывает за массовое удаление каналов/ролей за короткое время.',
    toggles: [{ key: 'enabled', label: 'Включено' }],
    selects: [],
    modals: [{ id: 'limits', label: 'Лимиты и наказание', title: 'Настройки антикраша', fields: [
      { key: 'limit', label: 'Лимит удалений', type: 'number', min: 1, max: 50, required: true, max_len: 3 },
      { key: 'interval', label: 'Окно времени (секунды)', type: 'number', min: 3, max: 300, required: true, max_len: 3 },
      { key: 'punishment', label: 'Наказание: ban / kick / strip', type: 'enum', options: ['ban', 'kick', 'strip'], required: true, max: 5 },
      { key: 'whitelistUsers', label: 'ID доверенных пользователей', type: 'list', style: 'paragraph', max: 1000 },
    ] }],
  },
  applications: {
    title: 'Заявки', emoji: '📝', path: 'applications',
    desc: 'Анкета (до 5 вопросов). Кнопку публикует команда `/application setup`.',
    toggles: [],
    selects: [
      { field: 'channelId', kind: 'channel', placeholder: 'Канал для рассмотрения заявок', types: TEXT },
      { field: 'acceptRoleId', kind: 'role', placeholder: 'Роль при принятии (необязательно)' },
    ],
    modals: [{ id: 'q', label: 'Вопросы', title: 'Вопросы анкеты (до 5)', fields: [
      { key: 'questions', label: 'Каждый вопрос с новой строки', type: 'lines', style: 'paragraph', max: 1000, required: true },
    ] }],
  },
  afk: {
    title: 'Контроль инактива', emoji: '💤', path: 'afk',
    desc: 'Раз в сутки выдаёт роль AFK тем, кто не проявлял активность N дней. Любая активность снимает роль.',
    toggles: [{ key: 'enabled', label: 'Включено' }],
    selects: [{ field: 'roleId', kind: 'role', placeholder: 'Роль AFK' }],
    modals: [{ id: 'days', label: 'Срок инактива', title: 'Срок инактива', fields: [
      { key: 'days', label: 'Дней без активности', type: 'number', min: 1, max: 365, required: true, max_len: 3 },
    ] }],
  },
  tickets: {
    title: 'Тикеты', emoji: '🎫', path: 'tickets',
    desc: 'Приватные каналы поддержки с текстовым логом. Панель публикует `/ticket setup`.',
    toggles: [{ key: 'enabled', label: 'Включено' }],
    selects: [
      { field: 'categoryId', kind: 'channel', placeholder: 'Категория для тикетов', types: [ChannelType.GuildCategory] },
      { field: 'logChannelId', kind: 'channel', placeholder: 'Канал логов тикетов', types: TEXT },
      { field: 'supportRoleId', kind: 'role', placeholder: 'Роль поддержки' },
    ],
  },
};

/* ---------- Утилиты ---------- */
const toArr = (v) =>
  v == null || v === '' ? [] : typeof v !== 'string' && typeof v[Symbol.iterator] === 'function' ? Array.from(v) : [v];
const getVal = (cfg, def, key) => cfg.get(`${def.path}.${key}`);
const code = (s) => `\`${String(s).replace(/`/g, "'").slice(0, 80)}\``;

function parse(f, raw) {
  const v = raw.trim();
  switch (f.type) {
    case 'number': {
      const n = Number(v);
      if (!Number.isFinite(n) || n < f.min || n > f.max) throw new Error(`«${f.label}»: число от ${f.min} до ${f.max}`);
      return Math.floor(n);
    }
    case 'list': {
      const list = v.split(/[\s,;]+/).filter(Boolean);
      if (list.some((x) => !/^\d{17,20}$/.test(x))) throw new Error(`«${f.label}»: нужны числовые ID`);
      return list;
    }
    case 'lines': {
      const lines = v.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 5);
      if (!lines.length) throw new Error('Нужен хотя бы один вопрос');
      return lines;
    }
    case 'hex':
      if (!/^#?[0-9a-f]{6}$/i.test(v)) throw new Error('Цвет должен быть в формате #RRGGBB');
      return v.startsWith('#') ? v : `#${v}`;
    case 'url':
      if (v && !/^https?:\/\/\S+$/i.test(v)) throw new Error('Баннер: нужна ссылка http(s)://…');
      return v || null;
    case 'enum':
      if (!f.options.includes(v.toLowerCase())) throw new Error(`«${f.label}»: ${f.options.join(' / ')}`);
      return v.toLowerCase();
    default:
      return v || null;
  }
}

/* ---------- Построение панелей ---------- */
function homePayload() {
  const embed = new EmbedBuilder()
    .setColor(COLOR).setFooter(FOOTER)
    .setTitle('⚙️ Панель управления')
    .setDescription(
      Object.values(MODULES).map((m) => `${m.emoji} **${m.title}** — ${m.desc}`).join('\n') +
        '\n\nВыберите модуль в списке ниже.'
    );
  const menu = new StringSelectMenuBuilder()
    .setCustomId('settings:menu')
    .setPlaceholder('Выберите модуль…')
    .addOptions(Object.entries(MODULES).map(([value, m]) => ({ label: m.title, value, emoji: m.emoji })));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

function describe(cfg, def) {
  const lines = [def.desc, ''];
  for (const t of def.toggles) lines.push(`${getVal(cfg, def, t.key) ? '✅' : '❌'} ${t.label}`);
  for (const s of def.selects) {
    if (s.kind === 'events') {
      const on = EVENTS.filter((e) => cfg.get(`${def.path}.events.${e.key}`)).map((e) => e.label);
      lines.push(`**События:** ${on.join(', ') || '—'}`);
      continue;
    }
    const arr = toArr(getVal(cfg, def, s.field)).map((id) => (s.kind === 'channel' ? `<#${id}>` : `<@&${id}>`));
    lines.push(`**${s.placeholder}:** ${arr.join(' ') || '—'}`);
  }
  for (const m of def.modals ?? [])
    for (const f of m.fields) lines.push(`**${f.label.split(':')[0]}:** ${toArr(getVal(cfg, def, f.key)).join(', ') ? code(toArr(getVal(cfg, def, f.key)).join(', ')) : '—'}`);
  return lines.join('\n');
}

function panelPayload(cfg, key) {
  const def = MODULES[key];
  const embed = new EmbedBuilder().setColor(COLOR).setFooter(FOOTER).setTitle(`${def.emoji} ${def.title}`).setDescription(describe(cfg, def));
  const rows = [];

  def.selects.forEach((s, i) => {
    if (s.kind === 'events') {
      rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`settings:events:${key}`).setPlaceholder('События журнала')
          .setMinValues(0).setMaxValues(EVENTS.length)
          .addOptions(EVENTS.map((e) => ({ label: e.label, value: e.key, default: Boolean(cfg.get(`${def.path}.events.${e.key}`)) })))
      ));
      return;
    }
    const cur = toArr(getVal(cfg, def, s.field));
    const menu = s.kind === 'channel'
      ? new ChannelSelectMenuBuilder().setChannelTypes(s.types)
      : new RoleSelectMenuBuilder();
    menu.setCustomId(`settings:sel:${key}:${i}`).setPlaceholder(s.placeholder).setMinValues(0).setMaxValues(s.multi ? 25 : 1);
    if (cur.length) s.kind === 'channel' ? menu.setDefaultChannels(cur) : menu.setDefaultRoles(cur);
    rows.push(new ActionRowBuilder().addComponents(menu));
  });

  const btns = [];
  for (const t of def.toggles) {
    const on = Boolean(getVal(cfg, def, t.key));
    btns.push(new ButtonBuilder().setCustomId(`settings:toggle:${key}:${t.key}`)
      .setLabel(`${t.label}: ${on ? 'ВКЛ' : 'ВЫКЛ'}`).setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary));
  }
  for (const m of def.modals ?? [])
    btns.push(new ButtonBuilder().setCustomId(`settings:modal:${key}:${m.id}`).setLabel(m.label).setEmoji('✏️').setStyle(ButtonStyle.Primary));
  if (def.preview)
    btns.push(new ButtonBuilder().setCustomId(`settings:preview:${key}`).setLabel('Предпросмотр').setEmoji('👁️').setStyle(ButtonStyle.Secondary));
  btns.push(new ButtonBuilder().setCustomId('settings:home').setLabel('Назад').setEmoji('↩️').setStyle(ButtonStyle.Secondary));
  rows.push(new ActionRowBuilder().addComponents(btns));

  return { embeds: [embed], components: rows };
}

/* ---------- Обработчик всех компонентов /settings ---------- */
async function handle(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
    return interaction.reply({ content: '❌ Нужно право «Управление сервером».', flags: EPHEMERAL });

  const [, action, key, extra] = interaction.customId.split(':');
  if (action === 'home') return interaction.update(homePayload());
  if (action === 'menu') {
    const cfg = await ensureGuild(interaction.guildId);
    return interaction.update(panelPayload(cfg, interaction.values[0]));
  }

  const def = MODULES[key];
  if (!def) return;
  const cfg = await ensureGuild(interaction.guildId);

  switch (action) {
    case 'toggle': {
      const p = `${def.path}.${extra}`;
      cfg.set(p, !cfg.get(p));
      await save(cfg);
      return interaction.update(panelPayload(cfg, key));
    }
    case 'sel': {
      const s = def.selects[Number(extra)];
      cfg.set(`${def.path}.${s.field}`, s.multi ? interaction.values : interaction.values[0] ?? null);
      await save(cfg);
      return interaction.update(panelPayload(cfg, key));
    }
    case 'events': {
      for (const e of EVENTS) cfg.set(`${def.path}.events.${e.key}`, interaction.values.includes(e.key));
      await save(cfg);
      return interaction.update(panelPayload(cfg, key));
    }
    case 'modal': {
      const md = def.modals.find((m) => m.id === extra);
      const modal = new ModalBuilder().setCustomId(`settings:submit:${key}:${md.id}`).setTitle(md.title.slice(0, 45));
      for (const f of md.fields) {
        let cur = getVal(cfg, def, f.key);
        if (cur && typeof cur !== 'string' && typeof cur !== 'number') cur = Array.from(cur).join(f.type === 'lines' ? '\n' : ' ');
        const maxLen = f.type === 'number' ? (f.max_len ?? 4) : (f.max ?? 100);
        const input = new TextInputBuilder()
          .setCustomId(f.key).setLabel(f.label.slice(0, 45))
          .setStyle(f.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setRequired(Boolean(f.required)).setMaxLength(maxLen);
        if (cur != null && String(cur) !== '') input.setValue(String(cur).slice(0, maxLen));
        modal.addComponents(new ActionRowBuilder().addComponents(input));
      }
      return interaction.showModal(modal);
    }
    case 'submit': {
      const md = def.modals.find((m) => m.id === extra);
      const errors = [];
      for (const f of md.fields) {
        try {
          cfg.set(`${def.path}.${f.key}`, parse(f, interaction.fields.getTextInputValue(f.key)));
        } catch (e) {
          errors.push(e.message);
        }
      }
      if (errors.length) return interaction.reply({ content: `❌ ${errors.join('\n❌ ')}`, flags: EPHEMERAL });
      await save(cfg);
      return interaction.update(panelPayload(cfg, key));
    }
    case 'preview': {
      const block = cfg.toObject()[def.path];
      const embed = buildTemplateEmbed(block, interaction.member, { mention: key === 'welcome' });
      return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
    }
  }
}

module.exports = { handle, homePayload, MODULES };
