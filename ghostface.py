import os
import json
import random
import sqlite3
import asyncio
import logging
from datetime import datetime, timezone, timedelta

import discord
from discord import app_commands
from discord.ext import commands, tasks
# ============================================================
# GHOSTFACE | BWS — ALL-IN-ONE DISCORD BOT
# Python 3.11+ | discord.py 2.4+
#
# TOKEN:
#   Add DISCORD_TOKEN to your hosting environment variables.
#
# Optional config.json:
# {
#   "guildId": 1547531639784214530,
#   "logChannelId": 1548372480333320202,
#   "inviteLogChannelId": 1547531645957972134,
#   "staffReviewChannelId": 1547531646419603486,
#   "mediaReviewChannelId": 1547531646419603486,
#   "adminRoleIds": ["1548007910234263662"]
# }
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s"
)
log = logging.getLogger("ghostface")

DEFAULT_CONFIG = {
    "guildId": 1547531639784214530,
    "logChannelId": 1548372480333320202,
    "inviteLogChannelId": 1547531645957972134,
    "staffReviewChannelId": 1547531646419603486,
    "mediaReviewChannelId": 1547531646419603486,
    "adminRoleIds": ["1548007910234263662"],
}

try:
    with open("config.json", "r", encoding="utf-8") as f:
        CONFIG = {**DEFAULT_CONFIG, **json.load(f)}
except (FileNotFoundError, json.JSONDecodeError):
    CONFIG = DEFAULT_CONFIG.copy()

TOKEN = os.getenv("DISCORD_TOKEN", "").strip()
if not TOKEN:
    raise RuntimeError(
        "Не задан DISCORD_TOKEN. Добавь переменную окружения DISCORD_TOKEN на хостинге."
    )

GUILD_ID = int(CONFIG["guildId"])
LOG_CHANNEL_ID = int(CONFIG["logChannelId"])
INVITE_LOG_CHANNEL_ID = int(CONFIG["inviteLogChannelId"])
STAFF_REVIEW_CHANNEL_ID = int(CONFIG["staffReviewChannelId"])
MEDIA_REVIEW_CHANNEL_ID = int(CONFIG["mediaReviewChannelId"])
ADMIN_ROLE_IDS = {int(x) for x in CONFIG.get("adminRoleIds", [])}

DB_PATH = "ghostface.db"


# ============================================================
# DATABASE
# ============================================================

db = sqlite3.connect(DB_PATH, check_same_thread=False)
db.row_factory = sqlite3.Row
db_lock = asyncio.Lock()


def db_init():
    cur = db.cursor()
    cur.executescript("""
    CREATE TABLE IF NOT EXISTS invite_counts (
        guild_id INTEGER NOT NULL,
        inviter_id INTEGER NOT NULL,
        uses INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, inviter_id)
    );

    CREATE TABLE IF NOT EXISTS invite_uses (
        guild_id INTEGER NOT NULL,
        invite_code TEXT NOT NULL,
        inviter_id INTEGER NOT NULL,
        uses INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, invite_code)
    );

    CREATE TABLE IF NOT EXISTS giveaways (
        message_id INTEGER PRIMARY KEY,
        channel_id INTEGER NOT NULL,
        guild_id INTEGER NOT NULL,
        prize TEXT NOT NULL,
        winners INTEGER NOT NULL,
        ends_at INTEGER NOT NULL,
        ended INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS giveaway_entries (
        message_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        PRIMARY KEY (message_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        age TEXT NOT NULL,
        about TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        message_id INTEGER,
        created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tournaments (
        message_id INTEGER PRIMARY KEY,
        guild_id INTEGER NOT NULL,
        channel_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tournament_players (
        message_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        nickname TEXT NOT NULL,
        server TEXT NOT NULL,
        PRIMARY KEY (message_id, user_id)
    );
    """)
    db.commit()


async def sql(query, params=(), fetch=False, many=False):
    async with db_lock:
        cur = db.cursor()
        if many:
            cur.executemany(query, params)
        else:
            cur.execute(query, params)
        result = cur.fetchall() if fetch else cur.lastrowid
        db.commit()
        return result


# ============================================================
# HELPERS
# ============================================================

def now_ts():
    return int(datetime.now(timezone.utc).timestamp())


def human_ts(ts):
    return f"<t:{int(ts)}:F>"


def human_relative(ts):
    return f"<t:{int(ts)}:R>"


def is_admin(member: discord.Member):
    if member.guild_permissions.administrator:
        return True
    return any(role.id in ADMIN_ROLE_IDS for role in member.roles)


def color_for(kind="normal"):
    if kind == "success":
        return discord.Color.green()
    if kind == "error":
        return discord.Color.red()
    if kind == "warning":
        return discord.Color.orange()
    if kind == "info":
        return discord.Color.blurple()
    return discord.Color.dark_theme()


def embed(title, description="", kind="normal"):
    return discord.Embed(
        title=title,
        description=description,
        color=color_for(kind),
        timestamp=datetime.now(timezone.utc)
    )


async def safe_send(channel, *, content=None, embed_obj=None, view=None):
    if not channel:
        return None
    try:
        return await channel.send(content=content, embed=embed_obj, view=view)
    except Exception:
        log.exception("Не удалось отправить сообщение")
        return None


async def get_text_channel(guild, channel_id):
    ch = guild.get_channel(channel_id)
    return ch if isinstance(ch, discord.TextChannel) else None


async def log_message(guild, title, description, kind="normal"):
    ch = await get_text_channel(guild, LOG_CHANNEL_ID)
    if ch:
        await safe_send(ch, embed_obj=embed(title, description, kind))


async def invite_log(guild, description):
    ch = await get_text_channel(guild, INVITE_LOG_CHANNEL_ID)
    if ch:
        await safe_send(ch, embed_obj=embed("🎫 Инвайт", description, "info"))


async def audit_reason(guild, action, target_id):
    """Returns (moderator, reason) from audit log when possible."""
    try:
        async for entry in guild.audit_logs(limit=8, action=action):
            if entry.target and getattr(entry.target, "id", None) == target_id:
                if (datetime.now(timezone.utc) - entry.created_at).total_seconds() < 15:
                    moderator = entry.user.mention if entry.user else "Неизвестно"
                    return moderator, entry.reason or "Причина не указана"
    except Exception:
        pass
    return "Неизвестно", "Причина не указана"


# ============================================================
# BOT
# ============================================================

intents = discord.Intents.default()
intents.guilds = True
intents.members = True
intents.message_content = True
intents.messages = True
intents.invites = True
intents.voice_states = True
intents.moderation = True

bot = commands.Bot(
    command_prefix="!",
    intents=intents,
    help_command=None
)

invite_cache = {}
giveaway_finish_tasks = {}


# ============================================================
# PERSISTENT GIVEAWAY VIEW
# ============================================================

class GiveawayView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(
        label="Участвовать",
        style=discord.ButtonStyle.primary,
        emoji="🎉",
        custom_id="ghostface:giveaway_join"
    )
    async def join(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not interaction.guild:
            return await interaction.response.send_message(
                "Эта кнопка работает только на сервере.", ephemeral=True
            )

        message_id = interaction.message.id
        row = await sql(
            "SELECT * FROM giveaways WHERE message_id=?",
            (message_id,),
            fetch=True
        )
        if not row or row[0]["ended"]:
            return await interaction.response.send_message(
                "❌ Розыгрыш уже завершён.", ephemeral=True
            )

        exists = await sql(
            "SELECT 1 FROM giveaway_entries WHERE message_id=? AND user_id=?",
            (message_id, interaction.user.id),
            fetch=True
        )
        if exists:
            await sql(
                "DELETE FROM giveaway_entries WHERE message_id=? AND user_id=?",
                (message_id, interaction.user.id)
            )
            return await interaction.response.send_message(
                "Ты вышел из розыгрыша.", ephemeral=True
            )

        await sql(
            "INSERT OR IGNORE INTO giveaway_entries(message_id,user_id) VALUES(?,?)",
            (message_id, interaction.user.id)
        )
        await interaction.response.send_message(
            "✅ Ты участвуешь в розыгрыше!", ephemeral=True
        )


# ============================================================
# APPLICATION VIEWS
# ============================================================

class ApplicationReviewView(discord.ui.View):
    def __init__(self, application_id):
        super().__init__(timeout=None)
        self.application_id = application_id

        for item in self.children:
            if isinstance(item, discord.ui.Button):
                item.custom_id = f"ghostface:app:{application_id}:{item.label}"

    async def process(self, interaction, status):
        if not is_admin(interaction.user):
            return await interaction.response.send_message(
                "❌ У тебя нет прав.", ephemeral=True
            )

        rows = await sql(
            "SELECT * FROM applications WHERE id=?",
            (self.application_id,),
            fetch=True
        )
        if not rows:
            return await interaction.response.send_message(
                "❌ Заявка не найдена.", ephemeral=True
            )

        app = rows[0]
        if app["status"] != "pending":
            return await interaction.response.send_message(
                f"❌ Заявка уже обработана: **{app['status']}**.",
                ephemeral=True
            )

        await sql(
            "UPDATE applications SET status=? WHERE id=?",
            (status, self.application_id)
        )

        title = "✅ Заявка принята" if status == "accepted" else "❌ Заявка отклонена"
        e = embed(title, f"Модератор: {interaction.user.mention}", "success" if status == "accepted" else "error")

        try:
            await interaction.message.edit(view=None)
        except Exception:
            pass

        await interaction.response.send_message(title, ephemeral=True)

        try:
            user = interaction.guild.get_member(app["user_id"]) or await bot.fetch_user(app["user_id"])
            await user.send(
                f"{title} на сервере **{interaction.guild.name}**."
            )
        except Exception:
            pass

    @discord.ui.button(label="Принять", style=discord.ButtonStyle.success, emoji="✅")
    async def accept(self, interaction, button):
        await self.process(interaction, "accepted")

    @discord.ui.button(label="Отклонить", style=discord.ButtonStyle.danger, emoji="❌")
    async def reject(self, interaction, button):
        await self.process(interaction, "rejected")


# ============================================================
# TOURNAMENT VIEW
# ============================================================

class TournamentView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(
        label="Записаться",
        style=discord.ButtonStyle.success,
        emoji="🏆",
        custom_id="ghostface:tournament_join"
    )
    async def join(self, interaction, button):
        rows = await sql(
            "SELECT * FROM tournaments WHERE message_id=? AND status='open'",
            (interaction.message.id,),
            fetch=True
        )
        if not rows:
            return await interaction.response.send_message(
                "❌ Турнир закрыт или не найден.", ephemeral=True
            )

        exists = await sql(
            "SELECT 1 FROM tournament_players WHERE message_id=? AND user_id=?",
            (interaction.message.id, interaction.user.id),
            fetch=True
        )
        if exists:
            return await interaction.response.send_message(
                "Ты уже записан на турнир.", ephemeral=True
            )

        await interaction.response.send_modal(
            TournamentSignupModal(interaction.message.id)
        )


class TournamentSignupModal(discord.ui.Modal, title="Регистрация на турнир"):
    nickname = discord.ui.TextInput(
        label="Игровой ник",
        placeholder="Например: Ghost_Narek",
        max_length=64
    )
    server = discord.ui.TextInput(
        label="ID / сервер",
        placeholder="Например: 01",
        max_length=64
    )

    def __init__(self, message_id):
        super().__init__()
        self.message_id = message_id

    async def on_submit(self, interaction):
        exists = await sql(
            "SELECT 1 FROM tournament_players WHERE message_id=? AND user_id=?",
            (self.message_id, interaction.user.id),
            fetch=True
        )
        if exists:
            return await interaction.response.send_message(
                "Ты уже зарегистрирован.", ephemeral=True
            )

        await sql(
            "INSERT INTO tournament_players(message_id,user_id,nickname,server) VALUES(?,?,?,?)",
            (self.message_id, interaction.user.id, str(self.nickname), str(self.server))
        )

        await update_tournament_panel(interaction.guild, self.message_id)

        await interaction.response.send_message(
            "🏆 Ты успешно зарегистрирован!", ephemeral=True
        )


async def update_tournament_panel(guild, message_id):
    rows = await sql(
        "SELECT * FROM tournaments WHERE message_id=?",
        (message_id,),
        fetch=True
    )
    if not rows:
        return

    t = rows[0]
    players = await sql(
        "SELECT * FROM tournament_players WHERE message_id=? ORDER BY rowid",
        (message_id,),
        fetch=True
    )

    channel = guild.get_channel(t["channel_id"])
    if not channel:
        return

    try:
        message = await channel.fetch_message(message_id)
    except Exception:
        return

    lines = []
    for i, p in enumerate(players, 1):
        member = guild.get_member(p["user_id"])
        mention = member.mention if member else f"<@{p['user_id']}>"
        lines.append(f"`{i}` {mention} — **{p['nickname']}** | `{p['server']}`")

    text = (
        f"{t['description']}\n\n"
        f"👥 **Участников: {len(players)}**\n"
        + ("\n".join(lines) if lines else "Пока никто не зарегистрирован.")
    )

    e = embed(
        f"🏆 {t['title']}",
        text,
        "info" if t["status"] == "open" else "warning"
    )
    await message.edit(embed=e, view=TournamentView() if t["status"] == "open" else None)


# ============================================================
# INVITE TRACKING
# ============================================================

async def refresh_invites(guild):
    try:
        invites = await guild.invites()
        invite_cache[guild.id] = {
            i.code: {
                "uses": i.uses or 0,
                "inviter_id": i.inviter.id if i.inviter else 0
            }
            for i in invites
        }

        # Keep DB invite-use state in sync.
        for i in invites:
            await sql(
                """INSERT INTO invite_uses(guild_id,invite_code,inviter_id,uses)
                   VALUES(?,?,?,?)
                   ON CONFLICT(guild_id,invite_code)
                   DO UPDATE SET inviter_id=excluded.inviter_id, uses=excluded.uses""",
                (guild.id, i.code, i.inviter.id if i.inviter else 0, i.uses or 0)
            )
    except discord.Forbidden:
        log.warning("Нет доступа к приглашениям на %s", guild.name)
    except Exception:
        log.exception("Ошибка refresh_invites")


async def detect_invite(guild):
    try:
        before = invite_cache.get(guild.id, {})
        invites = await guild.invites()

        used = None
        for i in invites:
            old = before.get(i.code)
            if old and (i.uses or 0) > old["uses"]:
                used = i
                break

        if used is None and len(invites) == 1:
            i = invites[0]
            old = before.get(i.code)
            if old is not None and (i.uses or 0) > old["uses"]:
                used = i

        invite_cache[guild.id] = {
            i.code: {
                "uses": i.uses or 0,
                "inviter_id": i.inviter.id if i.inviter else 0
            }
            for i in invites
        }

        return used
    except Exception:
        log.exception("Ошибка определения инвайта")
        return None


# ============================================================
# GIVEAWAYS
# ============================================================

async def finish_giveaway(message_id, forced=False):
    rows = await sql(
        "SELECT * FROM giveaways WHERE message_id=?",
        (message_id,),
        fetch=True
    )
    if not rows:
        return

    g = rows[0]
    if g["ended"]:
        return

    if not forced and g["ends_at"] > now_ts():
        return

    entries = await sql(
        "SELECT user_id FROM giveaway_entries WHERE message_id=?",
        (message_id,),
        fetch=True
    )

    channel = bot.get_channel(g["channel_id"])
    if not channel:
        await sql("UPDATE giveaways SET ended=1 WHERE message_id=?", (message_id,))
        return

    try:
        message = await channel.fetch_message(message_id)
    except Exception:
        message = None

    await sql(
        "UPDATE giveaways SET ended=1 WHERE message_id=?",
        (message_id,)
    )

    if not entries:
        result = "😢 Участников нет. Победитель не выбран."
    else:
        ids = [x["user_id"] for x in entries]
        count = min(max(1, g["winners"]), len(ids))
        winners = random.sample(ids, count)
        result = " ".join(f"<@{uid}>" for uid in winners)
        result = f"🎉 **Победители:** {result}\n🎁 **Приз:** {g['prize']}"

    e = embed("🎉 Розыгрыш завершён", result, "success" if entries else "warning")
    await safe_send(channel, embed_obj=e)

    if message:
        try:
            old = message.embeds[0] if message.embeds else embed("🎉 Розыгрыш")
            old.description = (
                f"🎁 **Приз:** {g['prize']}\n"
                f"🏆 **Победителей:** {g['winners']}\n"
                f"⏱️ Завершён: {human_ts(now_ts())}\n\n"
                f"{result}"
            )
            old.color = discord.Color.dark_grey()
            await message.edit(embed=old, view=None)
        except Exception:
            pass


async def giveaway_worker(message_id):
    try:
        while True:
            rows = await sql(
                "SELECT ends_at, ended FROM giveaways WHERE message_id=?",
                (message_id,),
                fetch=True
            )
            if not rows or rows[0]["ended"]:
                return

            wait = rows[0]["ends_at"] - now_ts()
            if wait <= 0:
                await finish_giveaway(message_id)
                return

            await asyncio.sleep(min(wait, 30))
    except asyncio.CancelledError:
        return
    except Exception:
        log.exception("Ошибка giveaway worker")


# ============================================================
# READY
# ============================================================

@bot.event
async def on_ready():
    db_init()

    # Persistent views: buttons continue working after restart.
    bot.add_view(GiveawayView())
    bot.add_view(TournamentView())

    guild = bot.get_guild(GUILD_ID)
    if guild:
        await refresh_invites(guild)

        # Rebuild active giveaway workers.
        active = await sql(
            "SELECT message_id FROM giveaways WHERE ended=0",
            fetch=True
        )
        for row in active:
            mid = row["message_id"]
            if mid not in giveaway_finish_tasks or giveaway_finish_tasks[mid].done():
                giveaway_finish_tasks[mid] = asyncio.create_task(
                    giveaway_worker(mid)
                )

    try:
        synced = await bot.tree.sync(guild=discord.Object(id=GUILD_ID))
        log.info("Synced %s slash commands", len(synced))
    except Exception:
        log.exception("Ошибка sync slash commands")

    set_dnd.start()
    log.info("GHOSTFACE запущен как %s", bot.user)


@tasks.loop(minutes=10)
async def set_dnd():
    try:
        await bot.change_presence(
            status=discord.Status.dnd,
            activity=discord.Game(name="BWS • GHOSTFACE")
        )
    except Exception:
        pass


@set_dnd.before_loop
async def before_dnd():
    await bot.wait_until_ready()


# ============================================================
# MEMBER / MESSAGE LOGS
# ============================================================

@bot.event
async def on_member_join(member):
    invite = await detect_invite(member.guild)

    if invite and invite.inviter:
        inviter_id = invite.inviter.id
        await sql(
            """INSERT INTO invite_counts(guild_id,inviter_id,uses)
               VALUES(?,?,1)
               ON CONFLICT(guild_id,inviter_id)
               DO UPDATE SET uses=uses+1""",
            (member.guild.id, inviter_id)
        )
        await invite_log(
            member.guild,
            f"👤 {member.mention} зашёл на сервер.\n"
            f"🎫 Пригласил: {invite.inviter.mention}\n"
            f"🔗 Код: `{invite.code}`"
        )
    else:
        await invite_log(
            member.guild,
            f"👤 {member.mention} зашёл на сервер.\n"
            f"🎫 Приглашение определить не удалось."
        )

    await log_message(
        member.guild,
        "📥 Участник вошёл",
        f"Пользователь: {member.mention}\nID: `{member.id}`"
    )


@bot.event
async def on_member_remove(member):
    await log_message(
        member.guild,
        "📤 Участник вышел",
        f"Пользователь: **{member}**\nID: `{member.id}`"
    )


@bot.event
async def on_message_delete(message):
    if message.author.bot:
        return
    content = message.content or "*без текста*"
    if len(content) > 1800:
        content = content[:1800] + "…"

    await log_message(
        message.guild,
        "🗑️ Сообщение удалено",
        f"Автор: {message.author.mention}\n"
        f"Канал: {message.channel.mention}\n"
        f"Содержимое:\n```{content}```"
    )


@bot.event
async def on_bulk_message_delete(messages):
    if not messages:
        return
    guild = messages[0].guild
    await log_message(
        guild,
        "🗑️ Массовое удаление",
        f"Канал: {messages[0].channel.mention}\n"
        f"Удалено сообщений: **{len(messages)}**"
    )


@bot.event
async def on_message_edit(before, after):
    if before.author.bot or before.content == after.content:
        return

    old = before.content or "*пусто*"
    new = after.content or "*пусто*"
    old = old[:700]
    new = new[:700]

    await log_message(
        before.guild,
        "✏️ Сообщение изменено",
        f"Автор: {before.author.mention}\n"
        f"Канал: {before.channel.mention}\n\n"
        f"**До:**\n```{old}```\n"
        f"**После:**\n```{new}```"
    )


# ============================================================
# MEMBER CHANGE LOGS
# ============================================================

@bot.event
async def on_member_update(before, after):
    if before.nick != after.nick:
        await log_message(
            after.guild,
            "🏷️ Ник изменён",
            f"{after.mention}\n"
            f"Было: `{before.nick or before.name}`\n"
            f"Стало: `{after.nick or after.name}`"
        )

    old_roles = {r.id: r for r in before.roles}
    new_roles = {r.id: r for r in after.roles}

    added = [new_roles[x] for x in new_roles.keys() - old_roles.keys()]
    removed = [old_roles[x] for x in old_roles.keys() - new_roles.keys()]

    if added:
        await log_message(
            after.guild,
            "➕ Роль выдана",
            f"{after.mention}\nРоли: " + ", ".join(r.mention for r in added)
        )

    if removed:
        await log_message(
            after.guild,
            "➖ Роль снята",
            f"{after.mention}\nРоли: " + ", ".join(r.mention for r in removed)
        )

    if before.communication_disabled_until != after.communication_disabled_until:
        if after.communication_disabled_until:
            await log_message(
                after.guild,
                "🔇 Тайм-аут",
                f"{after.mention}\nДо: {human_ts(after.communication_disabled_until.timestamp())}",
                "warning"
            )
        else:
            await log_message(
                after.guild,
                "🔊 Тайм-аут снят",
                f"{after.mention}"
            )


@bot.event
async def on_user_update(before, after):
    if before.name != after.name:
        for guild in bot.guilds:
            if guild.get_member(after.id):
                await log_message(
                    guild,
                    "👤 Username изменён",
                    f"Пользователь: <@{after.id}>\n"
                    f"Было: `{before.name}`\n"
                    f"Стало: `{after.name}`"
                )

    if before.avatar != after.avatar:
        for guild in bot.guilds:
            if guild.get_member(after.id):
                await log_message(
                    guild,
                    "🖼️ Аватар изменён",
                    f"Пользователь: <@{after.id}>"
                )


# ============================================================
# CHANNEL / ROLE / VOICE LOGS
# ============================================================

@bot.event
async def on_guild_channel_create(channel):
    await log_message(
        channel.guild,
        "📁 Канал создан",
        f"Название: **{channel.name}**\nID: `{channel.id}`\nТип: `{channel.type}`"
    )


@bot.event
async def on_guild_channel_delete(channel):
    await log_message(
        channel.guild,
        "🗑️ Канал удалён",
        f"Название: **{channel.name}**\nID: `{channel.id}`"
    )


@bot.event
async def on_guild_channel_update(before, after):
    changes = []
    if before.name != after.name:
        changes.append(f"Название: `{before.name}` → `{after.name}`")
    if getattr(before, "topic", None) != getattr(after, "topic", None):
        changes.append("Изменена тема канала")
    if changes:
        await log_message(
            after.guild,
            "✏️ Канал изменён",
            f"Канал: {after.mention}\n" + "\n".join(changes)
        )


@bot.event
async def on_guild_role_create(role):
    await log_message(
        role.guild,
        "🟢 Роль создана",
        f"Роль: {role.mention}\nID: `{role.id}`"
    )


@bot.event
async def on_guild_role_delete(role):
    await log_message(
        role.guild,
        "🔴 Роль удалена",
        f"Роль: **{role.name}**\nID: `{role.id}`"
    )


@bot.event
async def on_guild_role_update(before, after):
    changes = []
    if before.name != after.name:
        changes.append(f"Название: `{before.name}` → `{after.name}`")
    if before.permissions != after.permissions:
        changes.append("Изменены permissions")
    if before.mentionable != after.mentionable:
        changes.append(f"mentionable: `{before.mentionable}` → `{after.mentionable}`")
    if changes:
        await log_message(
            after.guild,
            "✏️ Роль изменена",
            f"Роль: {after.mention}\n" + "\n".join(changes)
        )


@bot.event
async def on_voice_state_update(member, before, after):
    if before.channel == after.channel:
        return

    if before.channel is None and after.channel:
        text = f"{member.mention} зашёл в **{after.channel.name}**"
    elif before.channel and after.channel is None:
        text = f"{member.mention} вышел из **{before.channel.name}**"
    else:
        text = (
            f"{member.mention} переместился\n"
            f"`{before.channel.name}` → `{after.channel.name}`"
        )

    await log_message(member.guild, "🔊 Голосовой канал", text)


# ============================================================
# BAN / UNBAN AUDIT LOG
# ============================================================

@bot.event
async def on_member_ban(guild, user):
    moderator, reason = await audit_reason(
        guild, discord.AuditLogAction.ban, user.id
    )
    await log_message(
        guild,
        "🔨 Пользователь заблокирован",
        f"Пользователь: **{user}** (`{user.id}`)\n"
        f"Модератор: {moderator}\n"
        f"Причина: **{reason}**",
        "warning"
    )


@bot.event
async def on_member_unban(guild, user):
    moderator, reason = await audit_reason(
        guild, discord.AuditLogAction.unban, user.id
    )
    await log_message(
        guild,
        "🔓 Пользователь разблокирован",
        f"Пользователь: **{user}** (`{user.id}`)\n"
        f"Модератор: {moderator}\n"
        f"Причина: **{reason}**",
        "success"
    )


# ============================================================
# INVITE COMMANDS
# ============================================================

@bot.tree.command(name="top-invites", description="Топ пользователей по приглашениям")
@app_commands.guilds(discord.Object(id=GUILD_ID))
async def top_invites(interaction):
    rows = await sql(
        """SELECT inviter_id, uses FROM invite_counts
           WHERE guild_id=? ORDER BY uses DESC LIMIT 10""",
        (interaction.guild.id,),
        fetch=True
    )

    if not rows:
        return await interaction.response.send_message(
            embed_obj=embed("🎫 Топ инвайтов", "Пока данных нет.")
        )

    lines = []
    for i, row in enumerate(rows, 1):
        lines.append(f"**{i}.** <@{row['inviter_id']}> — **{row['uses']}**")

    await interaction.response.send_message(
        embed=embed("🏆 Топ инвайтов", "\n".join(lines), "info")
    )


@bot.tree.command(name="invites", description="Показать количество приглашений пользователя")
@app_commands.guilds(discord.Object(id=GUILD_ID))
@app_commands.describe(user="Пользователь")
async def invites_cmd(interaction, user: discord.Member = None):
    user = user or interaction.user
    rows = await sql(
        "SELECT uses FROM invite_counts WHERE guild_id=? AND inviter_id=?",
        (interaction.guild.id, user.id),
        fetch=True
    )
    count = rows[0]["uses"] if rows else 0

    await interaction.response.send_message(
        embed=embed(
            "🎫 Приглашения",
            f"{user.mention} пригласил **{count}** участник(ов)."
        )
    )


@bot.tree.command(name="add-invites", description="Добавить инвайты пользователю")
@app_commands.guilds(discord.Object(id=GUILD_ID))
@app_commands.describe(user="Пользователь", amount="Количество")
async def add_invites(interaction, user: discord.Member, amount: int):
    if not is_admin(interaction.user):
        return await interaction.response.send_message(
            "❌ У тебя нет прав.", ephemeral=True
        )

    if amount == 0 or abs(amount) > 100000:
        return await interaction.response.send_message(
            "❌ Некорректное количество.", ephemeral=True
        )

    await sql(
        """INSERT INTO invite_counts(guild_id,inviter_id,uses)
           VALUES(?,?,?)
           ON CONFLICT(guild_id,inviter_id)
           DO UPDATE SET uses=uses+excluded.uses""",
        (interaction.guild.id, user.id, amount)
    )

    await interaction.response.send_message(
        f"✅ Для {user.mention} изменено количество инвайтов на **{amount:+d}**."
    )


# ============================================================
# GIVEAWAY COMMANDS
# ============================================================

@bot.tree.command(name="gstart", description="Запустить розыгрыш")
@app_commands.guilds(discord.Object(id=GUILD_ID))
@app_commands.describe(
    duration="Длительность в секундах",
    winners="Количество победителей",
    prize="Приз"
)
async def gstart(interaction, duration: int, winners: int, prize: str):
    if not is_admin(interaction.user):
        return await interaction.response.send_message(
            "❌ У тебя нет прав.", ephemeral=True
        )

    if duration < 10 or duration > 30 * 24 * 60 * 60:
        return await interaction.response.send_message(
            "❌ Длительность: от 10 секунд до 30 дней.", ephemeral=True
        )
    if winners < 1 or winners > 50:
        return await interaction.response.send_message(
            "❌ Победителей должно быть от 1 до 50.", ephemeral=True
        )
    if len(prize) > 200:
        return await interaction.response.send_message(
            "❌ Слишком длинное название приза.", ephemeral=True
        )

    ends_at = now_ts() + duration

    e = embed(
        "🎉 GHOSTFACE GIVEAWAY",
        f"🎁 **Приз:** {prize}\n"
        f"🏆 **Победителей:** {winners}\n"
        f"⏰ **Окончание:** {human_ts(ends_at)} ({human_relative(ends_at)})\n\n"
        f"Нажми кнопку ниже, чтобы участвовать!",
        "info"
    )

    await interaction.response.send_message(embed=e, view=GiveawayView())
    message = await interaction.original_response()

    await sql(
        """INSERT INTO giveaways(message_id,channel_id,guild_id,prize,winners,ends_at)
           VALUES(?,?,?,?,?,?)""",
        (
            message.id,
            interaction.channel.id,
            interaction.guild.id,
            prize,
            winners,
            ends_at
        )
    )

    giveaway_finish_tasks[message.id] = asyncio.create_task(
        giveaway_worker(message.id)
    )


@bot.tree.command(name="gend", description="Досрочно завершить розыгрыш")
@app_commands.guilds(discord.Object(id=GUILD_ID))
@app_commands.describe(message_id="ID сообщения розыгрыша")
async def gend(interaction, message_id: str):
    if not is_admin(interaction.user):
        return await interaction.response.send_message(
            "❌ У тебя нет прав.", ephemeral=True
        )

    try:
        mid = int(message_id)
    except ValueError:
        return await interaction.response.send_message(
            "❌ ID сообщения должен быть числом.", ephemeral=True
        )

    rows = await sql(
        "SELECT 1 FROM giveaways WHERE message_id=?",
        (mid,),
        fetch=True
    )
    if not rows:
        return await interaction.response.send_message(
            "❌ Розыгрыш не найден.", ephemeral=True
        )

    await finish_giveaway(mid, forced=True)
    await interaction.response.send_message("✅ Розыгрыш завершён.", ephemeral=True)


@bot.tree.command(name="greroll", description="Выбрать нового победителя")
@app_commands.guilds(discord.Object(id=GUILD_ID))
@app_commands.describe(message_id="ID сообщения розыгрыша")
async def greroll(interaction, message_id: str):
    if not is_admin(interaction.user):
        return await interaction.response.send_message(
            "❌ У тебя нет прав.", ephemeral=True
        )

    try:
        mid = int(message_id)
    except ValueError:
        return await interaction.response.send_message(
            "❌ ID сообщения должен быть числом.", ephemeral=True
        )

    rows = await sql(
        "SELECT * FROM giveaway_entries WHERE message_id=?",
        (mid,),
        fetch=True
    )
    if not rows:
        return await interaction.response.send_message(
            "❌ В этом розыгрыше нет участников.", ephemeral=True
        )

    winner = random.choice(rows)["user_id"]
    await interaction.response.send_message(
        f"🎉 Новый победитель: <@{winner}>"
    )


# ============================================================
# APPLICATION MODAL
# ============================================================

class ApplicationModal(discord.ui.Modal, title="Заявка"):
    name = discord.ui.TextInput(
        label="Имя / игровой ник",
        placeholder="Ваше имя или ник",
        max_length=100
    )
    age = discord.ui.TextInput(
        label="Возраст",
        placeholder="Например: 18",
        max_length=10
    )
    about = discord.ui.TextInput(
        label="О себе",
        placeholder="Расскажите немного о себе",
        style=discord.TextStyle.paragraph,
        max_length=1000
    )
    kind = discord.ui.TextInput(
        label="Тип заявки",
        placeholder="STAFF / MEDIA",
        max_length=20
    )

    async def on_submit(self, interaction):
        kind = str(self.kind).strip().upper()
        if kind not in ("STAFF", "MEDIA"):
            kind = "STAFF"

        review_channel_id = (
            MEDIA_REVIEW_CHANNEL_ID
            if kind == "MEDIA"
            else STAFF_REVIEW_CHANNEL_ID
        )
        channel = await get_text_channel(interaction.guild, review_channel_id)

        app_id = await sql(
            """INSERT INTO applications
               (guild_id,user_id,kind,name,age,about,created_at)
               VALUES(?,?,?,?,?,?,?)""",
            (
                interaction.guild.id,
                interaction.user.id,
                kind,
                str(self.name),
                str(self.age),
                str(self.about),
                now_ts()
            )
        )

        e = embed(
            f"📨 Новая заявка • {kind}",
            f"👤 **Пользователь:** {interaction.user.mention}\n"
            f"🆔 **ID:** `{interaction.user.id}`\n"
            f"📝 **Имя/ник:** {self.name}\n"
            f"🎂 **Возраст:** {self.age}\n\n"
            f"**О себе:**\n{self.about}",
            "info"
        )

        view = ApplicationReviewView(app_id)

        if channel:
            message = await channel.send(embed=e, view=view)
            await sql(
                "UPDATE applications SET message_id=? WHERE id=?",
                (message.id, app_id)
            )

        await interaction.response.send_message(
            "✅ Заявка отправлена на рассмотрение!", ephemeral=True
        )


class ApplicationStartView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(
        label="Подать заявку",
        style=discord.ButtonStyle.primary,
        emoji="📝",
        custom_id="ghostface:application_start"
    )
    async def start(self, interaction, button):
        await interaction.response.send_modal(ApplicationModal())


@bot.tree.command(name="setup-apply", description="Создать панель подачи заявки")
@app_commands.guilds(discord.Object(id=GUILD_ID))
async def setup_apply(interaction):
    if not is_admin(interaction.user):
        return await interaction.response.send_message(
            "❌ У тебя нет прав.", ephemeral=True
        )

    e = embed(
        "📨 Заявки",
        "Нажми **«Подать заявку»**, заполни форму и дождись решения администрации.",
        "info"
    )
    await interaction.response.send_message(
        embed=e,
        view=ApplicationStartView()
    )


# ============================================================
# TOURNAMENT COMMANDS
# ============================================================

@bot.tree.command(name="tournament-start", description="Создать регистрацию на турнир")
@app_commands.guilds(discord.Object(id=GUILD_ID))
@app_commands.describe(
    title="Название турнира",
    description="Описание турнира"
)
async def tournament_start(interaction, title: str, description: str):
    if not is_admin(interaction.user):
        return await interaction.response.send_message(
            "❌ У тебя нет прав.", ephemeral=True
        )

    e = embed(
        f"🏆 {title}",
        f"{description}\n\n"
        f"👥 **Участников: 0**\n"
        f"Нажми кнопку ниже для регистрации.",
        "info"
    )

    await interaction.response.send_message(
        embed=e,
        view=TournamentView()
    )
    message = await interaction.original_response()

    await sql(
        """INSERT INTO tournaments
           (message_id,guild_id,channel_id,title,description,created_at)
           VALUES(?,?,?,?,?,?)""",
        (
            message.id,
            interaction.guild.id,
            interaction.channel.id,
            title,
            description,
            now_ts()
        )
    )


@bot.tree.command(name="tournament-list", description="Показать участников турнира")
@app_commands.guilds(discord.Object(id=GUILD_ID))
@app_commands.describe(message_id="ID сообщения турнира")
async def tournament_list(interaction, message_id: str):
    try:
        mid = int(message_id)
    except ValueError:
        return await interaction.response.send_message(
            "❌ Неверный ID.", ephemeral=True
        )

    rows = await sql(
        "SELECT * FROM tournament_players WHERE message_id=? ORDER BY rowid",
        (mid,),
        fetch=True
    )

    if not rows:
        return await interaction.response.send_message(
            embed=embed("🏆 Участники", "Список пока пуст.")
        )

    lines = []
    for i, p in enumerate(rows, 1):
        lines.append(
            f"**{i}.** <@{p['user_id']}> — `{p['nickname']}` | `{p['server']}`"
        )

    await interaction.response.send_message(
        embed=embed(
            "🏆 Список участников",
            "\n".join(lines)
        )
    )


@bot.tree.command(name="tournament-close", description="Закрыть регистрацию турнира")
@app_commands.guilds(discord.Object(id=GUILD_ID))
@app_commands.describe(message_id="ID сообщения турнира")
async def tournament_close(interaction, message_id: str):
    if not is_admin(interaction.user):
        return await interaction.response.send_message(
            "❌ У тебя нет прав.", ephemeral=True
        )

    try:
        mid = int(message_id)
    except ValueError:
        return await interaction.response.send_message(
            "❌ Неверный ID.", ephemeral=True
        )

    rows = await sql(
        "SELECT 1 FROM tournaments WHERE message_id=?",
        (mid,),
        fetch=True
    )
    if not rows:
        return await interaction.response.send_message(
            "❌ Турнир не найден.", ephemeral=True
        )

    await sql(
        "UPDATE tournaments SET status='closed' WHERE message_id=?",
        (mid,)
    )
    await update_tournament_panel(interaction.guild, mid)

    await interaction.response.send_message(
        "🔒 Регистрация на турнир закрыта."
    )


# ============================================================
# ERROR HANDLING
# ============================================================

@bot.tree.error
async def on_app_command_error(interaction, error):
    original = getattr(error, "original", error)
    log.exception("Slash command error", exc_info=original)

    message = "❌ Произошла ошибка при выполнении команды."
    if isinstance(original, app_commands.MissingPermissions):
        message = "❌ У тебя недостаточно прав."

    try:
        if interaction.response.is_done():
            await interaction.followup.send(message, ephemeral=True)
        else:
            await interaction.response.send_message(message, ephemeral=True)
    except Exception:
        pass


@bot.event
async def on_error(event, *args, **kwargs):
    log.exception("Ошибка события: %s", event)


# ============================================================
# START
# ============================================================

if __name__ == "__main__":
    db_init()
    bot.run(TOKEN)
