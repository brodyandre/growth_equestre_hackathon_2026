#!/usr/bin/env python3
"""
Capture media assets for the CRM managerial report:
- static screenshot (PNG)
- short loop (GIF)

Usage (from repo root):
  python tools/docs/capture_managerial_report_media.py --ui-url http://127.0.0.1:3200 --start-server
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image
from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as ec
from selenium.webdriver.support.ui import Select, WebDriverWait


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "docs" / "readme_images"
PNG_PATH = OUT_DIR / "ui-crm-relatorio-gerencial.png"
GIF_PATH = OUT_DIR / "ui-crm-relatorio-gerencial-loop.gif"


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
    try:
        host_part = ui_url.split("://", 1)[1]
        host_port = host_part.split("/", 1)[0]
        return host_port.split(":", 1)[1]
    except Exception as exc:  # pragma: no cover
        raise ValueError(f"ui_url invalida: {ui_url}") from exc


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


def ensure_lead_selected(driver: webdriver.Chrome, wait: WebDriverWait) -> None:
    try:
        btn = wait.until(ec.element_to_be_clickable((By.CSS_SELECTOR, "button[data-action='open-details']")))
        driver.execute_script("arguments[0].click();", btn)
        wait.until(ec.presence_of_element_located((By.ID, "dOpenReportBtn")))
        return
    except TimeoutException:
        pass

    select_el = wait.until(ec.presence_of_element_located((By.ID, "dLeadSelect")))
    sel = Select(select_el)
    options = [o for o in sel.options if (o.get_attribute("value") or "").strip()]
    if not options:
        raise RuntimeError("Nao foi possivel selecionar lead para abrir o relatorio.")
    sel.select_by_value(options[0].get_attribute("value"))
    driver.execute_script(
        "arguments[0].dispatchEvent(new Event('change', { bubbles: true }));",
        select_el,
    )
    wait.until(ec.presence_of_element_located((By.ID, "dOpenReportBtn")))


def make_loop_gif(frame_paths: list[Path], gif_path: Path) -> None:
    frames: list[Image.Image] = []
    for p in frame_paths:
        img = Image.open(p).convert("RGB")
        target_w = 1080
        if img.width > target_w:
            target_h = int((target_w / img.width) * img.height)
            img = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
        img = img.convert("P", palette=Image.Palette.ADAPTIVE, colors=128)
        frames.append(img)

    if not frames:
        raise RuntimeError("Nenhum frame coletado para o GIF.")

    frames[0].save(
        gif_path,
        save_all=True,
        append_images=frames[1:],
        loop=0,
        duration=1000,
        optimize=True,
        disposal=2,
    )


def capture_assets(ui_url: str) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tmp_dir = OUT_DIR / ".tmp_managerial_report_frames"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--window-size=1720,980")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")

    driver = webdriver.Chrome(options=opts)
    wait = WebDriverWait(driver, 25)
    try:
        driver.get(f"{ui_url.rstrip('/')}/kanban")
        wait.until(ec.presence_of_element_located((By.ID, "kanbanRoot")))
        ensure_lead_selected(driver, wait)

        report_btn = wait.until(ec.element_to_be_clickable((By.ID, "dOpenReportBtn")))
        driver.execute_script("arguments[0].click();", report_btn)

        wait.until(ec.presence_of_element_located((By.CSS_SELECTOR, ".k-report-modal.is-open .k-report-dialog")))
        wait.until(ec.presence_of_element_located((By.CSS_SELECTOR, "#kReportBody .k-report-section")))
        time.sleep(0.4)

        dialog = driver.find_element(By.CSS_SELECTOR, ".k-report-modal.is-open .k-report-dialog")
        dialog.screenshot(str(PNG_PATH))

        body = driver.find_element(By.ID, "kReportBody")
        max_scroll = int(
            driver.execute_script(
                "return Math.max(arguments[0].scrollHeight - arguments[0].clientHeight, 0);",
                body,
            )
            or 0
        )

        positions = [0]
        if max_scroll > 0:
            positions.extend([int(max_scroll * 0.33), int(max_scroll * 0.66), max_scroll])

        frame_paths: list[Path] = []
        for idx, pos in enumerate(positions):
            driver.execute_script("arguments[0].scrollTop = arguments[1];", body, int(pos))
            time.sleep(0.25)
            frame = tmp_dir / f"frame_{idx:02d}.png"
            dialog.screenshot(str(frame))
            frame_paths.append(frame)

        make_loop_gif(frame_paths, GIF_PATH)
    finally:
        driver.quit()
        for tmp in tmp_dir.glob("*.png"):
            try:
                tmp.unlink()
            except Exception:
                pass
        try:
            tmp_dir.rmdir()
        except Exception:
            pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture managerial report media for README.")
    parser.add_argument("--ui-url", default="http://127.0.0.1:3200", help="Base URL of ui_web.")
    parser.add_argument(
        "--start-server",
        action="store_true",
        help="Start ui_web/server.js automatically if the URL is not already healthy.",
    )
    args = parser.parse_args()

    ui_url = args.ui_url.rstrip("/")
    proc: subprocess.Popen[str] | None = None
    try:
        is_up = wait_http_ok(f"{ui_url}/health-ui", timeout_s=3)
        if not is_up:
            if not args.start_server:
                raise RuntimeError(
                    f"UI indisponivel em {ui_url}. Rode com --start-server ou inicie o servidor manualmente."
                )
            proc = start_ui_web(ui_url)

        capture_assets(ui_url)
        print(f"[ok] png: {PNG_PATH.relative_to(ROOT)}")
        print(f"[ok] gif: {GIF_PATH.relative_to(ROOT)}")
        return 0
    except Exception as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1
    finally:
        safe_stop(proc)


if __name__ == "__main__":
    raise SystemExit(main())

