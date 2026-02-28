#!/usr/bin/env python3
"""
Generate a high-resolution README GIF showing sidebar navigation clicks in UI Node.js.

Covers pages:
- Visao geral
- Criar lead (demos)
- Leads
- CRM (Kanban)
- Parceiros
- Configuracoes
- Sobre Nos

Usage:
  python tools/docs/capture_ui_nav_tour_gif.py --ui-url http://127.0.0.1:3200 --start-server
"""

from __future__ import annotations

import argparse
import io
import os
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as ec
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "docs" / "readme_images"
OUT_GIF = OUT_DIR / "ui-nodejs-tour.gif"

PAGES = [
    {
        "path": "/",
        "label": "Visao geral",
        "ready": "#kpiLeads",
        "nav": ".sidebar-nav a[href='/']",
    },
    {
        "path": "/create-lead-demos",
        "label": "Criar lead (demos)",
        "ready": "#createLeadDemoForm",
        "nav": ".sidebar-nav a[href='/create-lead-demos']",
    },
    {
        "path": "/leads",
        "label": "Leads",
        "ready": "#leadsTable",
        "nav": ".sidebar-nav a[href='/leads']",
    },
    {
        "path": "/kanban",
        "label": "CRM (Kanban)",
        "ready": "#kanbanRoot",
        "nav": ".sidebar-nav a[href='/kanban']",
    },
    {
        "path": "/partners",
        "label": "Parceiros",
        "ready": "#partnersTable",
        "nav": ".sidebar-nav a[href='/partners']",
    },
    {
        "path": "/settings",
        "label": "Configuracoes",
        "ready": "#btnMlRetrainRun",
        "nav": ".sidebar-nav a[href='/settings']",
    },
    {
        "path": "/about",
        "label": "Sobre Nos",
        "ready": ".about-hero",
        "nav": ".sidebar-about-link[href='/about']",
    },
]


def wait_http_ok(url: str, timeout_s: int = 30) -> bool:
    start = time.time()
    while time.time() - start < timeout_s:
        try:
            with urllib.request.urlopen(url, timeout=3) as resp:
                if 200 <= int(resp.status) < 300:
                    return True
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
            time.sleep(0.5)
    return False


def parse_port(ui_url: str) -> str:
    host_part = ui_url.split("://", 1)[1]
    host_port = host_part.split("/", 1)[0]
    return host_port.split(":", 1)[1]


def start_ui_web(ui_url: str) -> subprocess.Popen[str]:
    port = parse_port(ui_url)
    env = os.environ.copy()
    env["PORT"] = port
    env.setdefault("BACKEND_URL", "http://127.0.0.1:3000")
    env.setdefault("ASSET_VERSION", str(int(time.time())))
    proc = subprocess.Popen(
        ["node", "ui_web/server.js"],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if not wait_http_ok(f"{ui_url.rstrip('/')}/health-ui", timeout_s=35):
        output = ""
        if proc.stdout:
            try:
                output = proc.stdout.read()
            except Exception:
                output = ""
        proc.terminate()
        raise RuntimeError(f"UI web nao subiu em {ui_url}. Log:\n{output}")
    return proc


def safe_stop(proc: subprocess.Popen[str] | None) -> None:
    if not proc:
        return
    try:
        proc.terminate()
        proc.wait(timeout=8)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def _font(size: int) -> ImageFont.ImageFont:
    for candidate in ("arial.ttf", "segoeui.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(candidate, size=size)
        except Exception:
            continue
    return ImageFont.load_default()


def capture_image(driver: webdriver.Chrome) -> Image.Image:
    png = driver.get_screenshot_as_png()
    return Image.open(io.BytesIO(png)).convert("RGBA")


def nav_center(driver: webdriver.Chrome, selector: str) -> tuple[float, float]:
    el = driver.find_element(By.CSS_SELECTOR, selector)
    rect = el.rect
    return rect["x"] + rect["width"] / 2.0, rect["y"] + rect["height"] / 2.0


def draw_cursor(draw: ImageDraw.ImageDraw, x: float, y: float, scale: float = 1.0) -> None:
    pts = [
        (x, y),
        (x + 20 * scale, y + 52 * scale),
        (x + 30 * scale, y + 40 * scale),
        (x + 45 * scale, y + 70 * scale),
        (x + 54 * scale, y + 64 * scale),
        (x + 39 * scale, y + 35 * scale),
        (x + 62 * scale, y + 35 * scale),
    ]
    draw.polygon(pts, fill=(255, 255, 255, 245), outline=(15, 25, 40, 255), width=max(1, int(2 * scale)))


def decorate_frame(
    base: Image.Image,
    label: str,
    target: tuple[float, float],
    idx: int,
    total: int,
    phase: str,
) -> Image.Image:
    img = base.copy()
    draw = ImageDraw.Draw(img, "RGBA")
    w, _ = img.size

    title_font = _font(34)
    sub_font = _font(24)

    draw.rounded_rectangle((24, 22, 820, 138), radius=22, fill=(5, 18, 40, 160), outline=(92, 184, 255, 180), width=2)
    draw.text((44, 40), "Tour UI Node.js + EJS", font=title_font, fill=(232, 247, 255, 255))
    draw.text((44, 88), f"{idx + 1}/{total} - {label}", font=sub_font, fill=(150, 222, 255, 255))

    tx, ty = target
    if phase in {"click1", "click2"}:
        ring = 18 if phase == "click1" else 34
        alpha = 210 if phase == "click1" else 120
        draw.ellipse((tx - ring, ty - ring, tx + ring, ty + ring), outline=(98, 218, 255, alpha), width=4)
        draw.ellipse((tx - ring - 12, ty - ring - 12, tx + ring + 12, ty + ring + 12), outline=(98, 218, 255, int(alpha * 0.6)), width=3)

    if phase == "approach":
        cx, cy = tx - 82, ty - 58
    elif phase == "settle":
        cx, cy = tx - 42, ty - 36
    else:
        cx, cy = tx - 18, ty - 16

    draw_cursor(draw, cx, cy, scale=1.05)

    # subtle spotlight near clicked menu
    draw.ellipse((tx - 120, ty - 60, tx + 120, ty + 60), fill=(59, 174, 255, 34))

    # footer caption for readability on GitHub dark theme
    footer_h = 56
    draw.rectangle((0, img.height - footer_h, w, img.height), fill=(3, 10, 25, 165))
    draw.text((26, img.height - 40), "Clique no menu lateral para navegar pelas telas operacionais", font=_font(22), fill=(209, 236, 255, 245))

    return img


def make_gif(frames: list[Image.Image], durations: list[int], out_path: Path) -> None:
    converted = [f.convert("P", palette=Image.Palette.ADAPTIVE, colors=160) for f in frames]
    converted[0].save(
        out_path,
        save_all=True,
        append_images=converted[1:],
        loop=0,
        duration=durations,
        optimize=True,
        disposal=2,
    )


def capture_tour(ui_url: str) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--window-size=1920,1080")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")

    driver = webdriver.Chrome(options=opts)
    wait = WebDriverWait(driver, 30)

    frames: list[Image.Image] = []
    durations: list[int] = []

    try:
        base = ui_url.rstrip("/")
        for idx, page in enumerate(PAGES):
            driver.get(f"{base}{page['path']}")
            wait.until(ec.presence_of_element_located((By.CSS_SELECTOR, page["ready"])))
            wait.until(ec.presence_of_element_located((By.CSS_SELECTOR, page["nav"])))
            driver.execute_script("window.scrollTo(0, 0);")
            time.sleep(0.4)

            target = nav_center(driver, page["nav"])
            screenshot = capture_image(driver)

            for phase, ms in (
                ("approach", 240),
                ("click1", 220),
                ("click2", 240),
                ("settle", 900 if page["path"] != "/about" else 1200),
            ):
                frames.append(decorate_frame(screenshot, page["label"], target, idx, len(PAGES), phase))
                durations.append(ms)

        make_gif(frames, durations, OUT_GIF)
    finally:
        driver.quit()


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture a high-res UI nav tour GIF for README.")
    parser.add_argument("--ui-url", default="http://127.0.0.1:3200", help="Base URL of ui_web.")
    parser.add_argument(
        "--start-server",
        action="store_true",
        help="Start ui_web/server.js if URL is not already healthy.",
    )
    args = parser.parse_args()

    ui_url = args.ui_url.rstrip("/")
    proc: subprocess.Popen[str] | None = None

    try:
        is_up = wait_http_ok(f"{ui_url}/health-ui", timeout_s=3)
        if not is_up:
            if not args.start_server:
                raise RuntimeError(f"UI indisponivel em {ui_url}. Rode com --start-server.")
            proc = start_ui_web(ui_url)

        capture_tour(ui_url)
        print(f"[ok] gif: {OUT_GIF.relative_to(ROOT)}")
        return 0
    except Exception as exc:
        print(f"[erro] {exc}")
        return 1
    finally:
        safe_stop(proc)


if __name__ == "__main__":
    raise SystemExit(main())
