import asyncio
import io
import math
import os
import sys
from pathlib import Path

import discord
from discord.ext import tasks
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

# pip install -U discord.py pillow

# Переменные окружения (задаются в панели хостинга):
#   DISCORD_TOKEN — токен бота
#   GUILD_ID      — ID сервера
TOKEN = os.getenv("DISCORD_TOKEN")
GUILD_ID = int(os.getenv("GUILD_ID", "0"))

if not TOKEN or not GUILD_ID:
    sys.exit("Не заданы переменные окружения DISCORD_TOKEN и/или GUILD_ID")

BASE_DIR = Path(__file__).resolve().parent
TEMPLATE = BASE_DIR / "92001.png"   # шаблон с пустыми рамками (1920x1080)
FONT_PATH = BASE_DIR / "font.ttf"   # жирный шрифт (Noto Serif Bold и т.п.), загрузите на хостинг
FONT_SIZE = 78
TEXT_COLOR = (235, 235, 240)
UPDATE_MINUTES = 10                 # не меньше 5 — лимиты Discord

ANIMATED = True                     # GIF-баннер нужен буст 3 уровня; иначе бот сам пришлёт PNG
FRAMES = 20                         # число кадров
FRAME_MS = 90                       # длительность кадра, мс
OUT_SIZE = (960, 540)               # размер GIF (меньше = легче файл, лимит Discord 10 МБ)
LOGO_BOX = (600, 230, 1320, 570)    # область логотипа, которая «пульсирует»

POS_MEMBERS = (650, 840)            # центры цифр в рамках
POS_VOICE = (1270, 840)

intents = discord.Intents.default()
intents.members = True              # Server Members Intent в Dev Portal
intents.voice_states = True

bot = discord.Client(intents=intents)
last_values = (None, None)


def draw_base(total: int, voice: int) -> Image.Image:
    img = Image.open(TEMPLATE).convert("RGB")
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(str(FONT_PATH), FONT_SIZE)
    draw.text(POS_MEMBERS, f"{total:,}".replace(",", " "),
              font=font, fill=TEXT_COLOR, anchor="mm")
    draw.text(POS_VOICE, str(voice), font=font, fill=TEXT_COLOR, anchor="mm")
    return img


def make_png(total: int, voice: int) -> bytes:
    buf = io.BytesIO()
    draw_base(total, voice).save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def make_gif(total: int, voice: int) -> bytes:
    base = draw_base(total, voice)

    # свечение берём только от ярких частей логотипа, чтобы фон не светлел
    logo = base.crop(LOGO_BOX)
    glow = logo.point(lambda v: max(0, v - 70) * 2).filter(ImageFilter.GaussianBlur(16))

    frames = []
    for i in range(FRAMES):
        a = 0.5 - 0.5 * math.cos(2 * math.pi * i / FRAMES)    # плавно 0 → 1 → 0
        frame = base.copy()
        frame.paste(ImageChops.add(logo, glow.point(lambda v: int(v * a * 0.9))),
                    LOGO_BOX[:2])
        frames.append(frame.resize(OUT_SIZE, Image.LANCZOS))

    buf = io.BytesIO()
    frames[0].save(buf, format="GIF", save_all=True, append_images=frames[1:],
                   duration=FRAME_MS, loop=0, optimize=True)
    return buf.getvalue()


@tasks.loop(minutes=UPDATE_MINUTES)
async def update_banner():
    global last_values

    guild = bot.get_guild(GUILD_ID)
    if guild is None:
        return

    total = guild.member_count
    voice = sum(1 for m in guild.members if m.voice and not m.bot)

    if (total, voice) == last_values:       # ничего не изменилось — не трогаем API
        return

    try:
        if ANIMATED:
            try:
                data = await asyncio.to_thread(make_gif, total, voice)
                await guild.edit(banner=data)
            except discord.HTTPException as e:
                print("GIF не принят (нужен буст 3 ур.?), ставлю PNG:", e)
                await guild.edit(banner=await asyncio.to_thread(make_png, total, voice))
        else:
            await guild.edit(banner=await asyncio.to_thread(make_png, total, voice))

        last_values = (total, voice)
        print(f"Баннер обновлён: {total} / {voice}")
    except discord.HTTPException as e:
        print("Ошибка обновления баннера:", e)


@bot.event
async def on_ready():
    print(f"Вошёл как {bot.user}")
    if not update_banner.is_running():
        update_banner.start()


bot.run(TOKEN)
