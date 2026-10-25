import asyncio
import io
import math
import os
import subprocess
import sys
from pathlib import Path

import discord
from discord.ext import tasks

try:
    from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
except ImportError:
    # если хостинг не поставил зависимости из requirements.txt — ставим сами
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow"])
    from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

# ───────────── Переменные окружения (задаются в панели хостинга) ─────────────
#   DISCORD_TOKEN — токен бота
#   GUILD_ID      — ID сервера
TOKEN = os.getenv("DISCORD_TOKEN")
GUILD_ID = int(os.getenv("GUILD_ID", "0"))

if not TOKEN or not GUILD_ID:
    sys.exit("Не заданы переменные окружения DISCORD_TOKEN и/или GUILD_ID")

# ───────────── Файлы (лежат рядом со скриптом) ─────────────
BASE_DIR = Path(__file__).resolve().parent
BACKGROUND = BASE_DIR / "bg_clean.jpg"   # фон с очищенными табличками (2576x1437)
FONT_PATH = BASE_DIR / "font.ttf"        # жирный шрифт, лучше с засечками

# ───────────── Настройки текста ─────────────
# Все координаты — в системе исходной картинки 2576x1437.
POS_MEMBERS = (532, 1170)     # центр цифры «Участников»
POS_VOICE = (2010, 1170)      # центр цифры «В войсе»
BOX_W, BOX_H = 510, 340       # максимальный размер цифр внутри таблички
MAX_FONT = 320                # размер шрифта подбирается автоматически, но не больше
TEXT_COLOR = (18, 18, 22)     # «выбитый» тёмный текст, как у заголовков
EDGE_COLOR = (150, 150, 156)  # светлая кромка снизу-справа для объёма
EDGE_OFFSET = 3

# ───────────── Обрезка и размеры ─────────────
SRC_CROP = (11, 0, 2565, 1437)   # обрезка до 16:9
STATIC_SIZE = (1920, 1080)       # размер обычной картинки
GIF_SIZE = (960, 540)            # размер GIF (лимит Discord на файл — 10 МБ)

# ───────────── Анимация ─────────────
ANIMATED = True                  # GIF-баннер нужен буст 3 уровня; иначе бот сам поставит картинку
FRAMES = 24                      # число кадров
FRAME_MS = 80                    # длительность кадра, мс
LOGO_SRC = (700, 0, 1860, 660)   # область логотипа и креста, которая «пульсирует»
GLOW_THRESHOLD = 170             # чем выше, тем меньше деталей светится

UPDATE_MINUTES = 10              # не меньше 5 — лимиты Discord

intents = discord.Intents.default()
intents.members = True           # Server Members Intent в Dev Portal
intents.voice_states = True

bot = discord.Client(intents=intents)
last_values = (None, None)


def fmt_number(n: int) -> str:
    return f"{n:,}".replace(",", " ")


def fit_font(draw: ImageDraw.ImageDraw, texts) -> ImageFont.FreeTypeFont:
    """Один размер шрифта для обеих табличек — максимальный, при котором всё влезает."""
    size = MAX_FONT
    while size > 40:
        font = ImageFont.truetype(str(FONT_PATH), size)
        fits = True
        for t in texts:
            l, top, r, b = draw.textbbox((0, 0), t, font=font)
            if r - l > BOX_W or b - top > BOX_H:
                fits = False
        if fits:
            return font
        size -= 8
    return ImageFont.truetype(str(FONT_PATH), 40)


def draw_centered(draw, center, text, font):
    l, top, r, b = draw.textbbox((0, 0), text, font=font)
    x = center[0] - (r - l) / 2 - l
    y = center[1] - (b - top) / 2 - top
    draw.text((x + EDGE_OFFSET, y + EDGE_OFFSET), text, font=font, fill=EDGE_COLOR)
    draw.text((x, y), text, font=font, fill=TEXT_COLOR)


def draw_base(total: int, voice: int) -> Image.Image:
    img = Image.open(BACKGROUND).convert("RGB")
    draw = ImageDraw.Draw(img)
    texts = (fmt_number(total), str(voice))
    font = fit_font(draw, texts)
    draw_centered(draw, POS_MEMBERS, texts[0], font)
    draw_centered(draw, POS_VOICE, texts[1], font)
    return img.crop(SRC_CROP)


def make_static(total: int, voice: int) -> bytes:
    img = draw_base(total, voice).resize(STATIC_SIZE, Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


def make_gif(total: int, voice: int) -> bytes:
    base = draw_base(total, voice).resize(GIF_SIZE, Image.LANCZOS)

    # область пульсации в координатах GIF
    sx = GIF_SIZE[0] / (SRC_CROP[2] - SRC_CROP[0])
    box = (int((LOGO_SRC[0] - SRC_CROP[0]) * sx), int(LOGO_SRC[1] * sx),
           int((LOGO_SRC[2] - SRC_CROP[0]) * sx), int(LOGO_SRC[3] * sx))
    region = base.crop(box)

    # свечение берём только от ярких частей, чтобы фон не светлел
    lum = region.convert("L")
    glow_l = lum.point(lambda v: max(0, v - GLOW_THRESHOLD) * 3).filter(ImageFilter.GaussianBlur(9))
    glow = Image.merge("RGB", (glow_l.point(lambda v: int(v * 0.9)),
                               glow_l.point(lambda v: int(v * 0.95)),
                               glow_l))

    # одна палитра на все кадры — меняется только область логотипа, файл получается лёгким
    pal_base = base.quantize(colors=256, dither=Image.Dither.FLOYDSTEINBERG)

    frames = []
    for i in range(FRAMES):
        a = 0.5 - 0.5 * math.cos(2 * math.pi * i / FRAMES)    # плавно 0 → 1 → 0
        lit = ImageChops.add(region, glow.point(lambda v: int(v * a * 0.9)))
        lit_p = lit.quantize(palette=pal_base, dither=Image.Dither.FLOYDSTEINBERG)
        frame = pal_base.copy()
        frame.paste(lit_p, box[:2])
        frames.append(frame)

    buf = io.BytesIO()
    frames[0].save(buf, format="GIF", save_all=True, append_images=frames[1:],
                   duration=FRAME_MS, loop=0, optimize=False)
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
                print("GIF не принят (нужен буст 3 ур.?), ставлю обычную картинку:", e)
                await guild.edit(banner=await asyncio.to_thread(make_static, total, voice))
        else:
            await guild.edit(banner=await asyncio.to_thread(make_static, total, voice))

        last_values = (total, voice)
        print(f"Баннер обновлён: {total} / {voice}")
    except discord.HTTPException as e:
        print("Ошибка обновления баннера:", e)


@bot.event
async def on_ready():
    print(f"Вошёл как {bot.user}")
    if not update_banner.is_running():
        update_banner.start()


if __name__ == "__main__":
    bot.run(TOKEN)
