#!/usr/bin/env python3
"""
Capture media assets for the CRM managerial report:
- static screenshot (PNG)
- short loop (GIF)
- kanban details focused on a target lead
- detailed screenshots per managerial report section

Usage (from repo root):
  python tools/docs/capture_managerial_report_media.py --ui-url http://127.0.0.1:3200 --start-server
  python tools/docs/capture_managerial_report_media.py --ui-url http://127.0.0.1:3200 --start-server --capture-lead-deep --lead-query "Luiz Andre"
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webelement import WebElement
from selenium.webdriver.support import expected_conditions as ec
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "docs" / "readme_images"
PNG_PATH = OUT_DIR / "ui-crm-relatorio-gerencial.png"
GIF_PATH = OUT_DIR / "ui-crm-relatorio-gerencial-loop.gif"
PNG_KANBAN_LUIZ_DETAILS = OUT_DIR / "ui-crm-kanban-luiz-andre-detalhes.png"
PNG_REPORT_LUIZ_TOP = OUT_DIR / "ui-crm-relatorio-luiz-andre-visao-geral.png"
PNG_REPORT_LUIZ_S1 = OUT_DIR / "ui-crm-relatorio-luiz-andre-secao-1-encaminhamento.png"
PNG_REPORT_LUIZ_S2 = OUT_DIR / "ui-crm-relatorio-luiz-andre-secao-2-cadastro.png"
PNG_REPORT_LUIZ_S3 = OUT_DIR / "ui-crm-relatorio-luiz-andre-secao-3-inteligencia.png"
PNG_REPORT_LUIZ_S4 = OUT_DIR / "ui-crm-relatorio-luiz-andre-secao-4-engajamento.png"
PNG_REPORT_LUIZ_S5 = OUT_DIR / "ui-crm-relatorio-luiz-andre-secao-5-matching.png"
PNG_REPORT_LUIZ_S6 = OUT_DIR / "ui-crm-relatorio-luiz-andre-secao-6-riscos-governanca.png"


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


def normalize_text(value: str | None) -> str:
    raw = str(value or "")
    decomposed = unicodedata.normalize("NFD", raw)
    ascii_only = decomposed.encode("ascii", "ignore").decode("ascii")
    lowered = ascii_only.lower()
    return re.sub(r"\s+", " ", lowered).strip()


def ensure_lead_selected(driver: webdriver.Chrome, wait: WebDriverWait) -> None:
    wait.until(ec.presence_of_element_located((By.ID, "dLeadSelect")))
    for _ in range(20):
        result = driver.execute_script(
            """
            const sel = document.getElementById('dLeadSelect');
            if (!sel) return { ok: false, reason: 'missing' };
            const opts = Array.from(sel.options || []).filter((o) => (o.value || '').trim());
            if (!opts.length) return { ok: false, reason: 'empty' };
            const current = (sel.value || '').trim();
            if (!current) {
              sel.value = opts[0].value;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return { ok: true, value: sel.value || '' };
            """
        )
        if result and result.get("ok") and str(result.get("value") or "").strip():
            time.sleep(0.2)
            return
        time.sleep(0.2)
    raise RuntimeError("Nao foi possivel estabilizar o seletor de lead no CRM.")


def select_lead_by_query(driver: webdriver.Chrome, wait: WebDriverWait, lead_query: str) -> tuple[str, str]:
    query_norm = normalize_text(lead_query)
    wait.until(ec.presence_of_element_located((By.ID, "dLeadSelect")))
    options = driver.execute_script(
        """
        const sel = document.getElementById('dLeadSelect');
        if (!sel) return [];
        return Array.from(sel.options || [])
          .filter((o) => (o.value || '').trim())
          .map((o) => ({ value: String(o.value || '').trim(), text: String(o.text || '').trim() }));
        """
    )
    if not options:
        raise RuntimeError("Nao ha leads disponiveis no seletor do CRM.")

    chosen = None
    for opt in options:
        if query_norm and query_norm in normalize_text(opt.get("text")):
            chosen = opt
            break

    if chosen is None:
        raise RuntimeError(f"Lead '{lead_query}' nao encontrado no seletor do CRM.")

    lead_id = str(chosen.get("value") or "").strip()
    lead_label = str(chosen.get("text") or "").strip()
    driver.execute_script(
        """
        const sel = document.getElementById('dLeadSelect');
        if (!sel) return;
        sel.value = arguments[0] || '';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        """,
        lead_id,
    )
    time.sleep(0.35)
    return lead_id, lead_label


def set_kanban_search(driver: webdriver.Chrome, lead_query: str) -> None:
    driver.execute_script(
        """
        const input = document.getElementById('kSearch');
        if (!input) return;
        input.value = arguments[0] || '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        """,
        lead_query,
    )


def highlight_selected_card(driver: webdriver.Chrome, lead_id: str) -> None:
    driver.execute_script(
        """
        const btn = document.querySelector(`button[data-action="open-details"][data-id="${arguments[0]}"]`);
        if (!btn) return;
        const card = btn.closest('.k-card');
        if (!card) return;
        card.style.outline = '3px solid #ff4b6e';
        card.style.outlineOffset = '1px';
        card.style.boxShadow = '0 0 0 2px rgba(255,75,110,0.22), inset 0 0 0 1px rgba(255,75,110,0.22)';
        """,
        lead_id,
    )


def capture_report_sections(dialog: WebElement, driver: webdriver.Chrome) -> None:
    dialog.screenshot(str(PNG_REPORT_LUIZ_TOP))
    output_paths = [
        PNG_REPORT_LUIZ_S1,
        PNG_REPORT_LUIZ_S2,
        PNG_REPORT_LUIZ_S3,
        PNG_REPORT_LUIZ_S4,
        PNG_REPORT_LUIZ_S5,
        PNG_REPORT_LUIZ_S6,
    ]
    for idx, out in enumerate(output_paths):
        current_sections = driver.find_elements(By.CSS_SELECTOR, "#kReportBody .k-report-section")
        if idx >= len(current_sections):
            break
        section = current_sections[idx]
        driver.execute_script(
            "arguments[0].scrollTop = Math.max(arguments[1].offsetTop - 12, 0);",
            dialog,
            section,
        )
        time.sleep(0.25)
        section.screenshot(str(out))


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
        duration=900,
        optimize=True,
        disposal=2,
    )


def make_motion_frames_from_still(still_path: Path, tmp_dir: Path) -> list[Path]:
    base = Image.open(still_path).convert("RGB")
    w, h = base.size
    max_shift = max(0, h - 2)
    shifts = [0, min(8, max_shift), min(16, max_shift), min(8, max_shift)]

    out_paths: list[Path] = []
    for idx, shift in enumerate(shifts):
        if shift <= 0:
            frame = base.copy()
        else:
            frame = Image.new("RGB", (w, h), (5, 10, 18))
            crop = base.crop((0, shift, w, h))
            frame.paste(crop, (0, 0))

        out = tmp_dir / f"frame_motion_{idx:02d}.png"
        frame.save(out)
        out_paths.append(out)

    return out_paths


def capture_assets(ui_url: str, lead_query: str, capture_lead_deep: bool = False) -> None:
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
        lead_id, _lead_label = select_lead_by_query(driver, wait, lead_query)
        set_kanban_search(driver, lead_query)
        time.sleep(0.45)
        highlight_selected_card(driver, lead_id)
        time.sleep(0.2)
        if capture_lead_deep:
            driver.save_screenshot(str(PNG_KANBAN_LUIZ_DETAILS))

        report_btn = wait.until(ec.element_to_be_clickable((By.ID, "dOpenReportBtn")))
        driver.execute_script("arguments[0].click();", report_btn)

        wait.until(ec.presence_of_element_located((By.CSS_SELECTOR, ".k-report-modal.is-open .k-report-dialog")))
        wait.until(ec.presence_of_element_located((By.CSS_SELECTOR, "#kReportBody .k-report-section")))
        time.sleep(0.4)

        dialog = driver.find_element(By.CSS_SELECTOR, ".k-report-modal.is-open .k-report-dialog")
        dialog.screenshot(str(PNG_PATH))
        if capture_lead_deep:
            capture_report_sections(dialog, driver)

        # The modal scroll is owned by ".k-report-dialog" (overflow: auto), not by #kReportBody.
        # We scroll the dialog to capture multiple report sections in sequence.
        scroll_target = dialog
        max_scroll = int(
            driver.execute_script(
                "return Math.max(arguments[0].scrollHeight - arguments[0].clientHeight, 0);",
                scroll_target,
            )
            or 0
        )

        positions = [0]
        if max_scroll > 0:
            positions.extend([int(max_scroll * 0.34), int(max_scroll * 0.68), max_scroll])

        frame_paths: list[Path] = []
        for idx, pos in enumerate(positions):
            driver.execute_script("arguments[0].scrollTop = arguments[1];", scroll_target, int(pos))
            time.sleep(0.25)
            frame = tmp_dir / f"frame_{idx:02d}.png"
            dialog.screenshot(str(frame))
            frame_paths.append(frame)

        if len(frame_paths) <= 1:
            frame_paths = make_motion_frames_from_still(PNG_PATH, tmp_dir)

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
    parser.add_argument(
        "--lead-query",
        default="Luiz Andre",
        help="Nome (ou parte do nome) do lead para selecionar no CRM.",
    )
    parser.add_argument(
        "--capture-lead-deep",
        action="store_true",
        help="Captura evidencias detalhadas do lead selecionado e das secoes do relatorio gerencial.",
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

        capture_assets(ui_url, lead_query=args.lead_query, capture_lead_deep=args.capture_lead_deep)
        print(f"[ok] png: {PNG_PATH.relative_to(ROOT)}")
        print(f"[ok] gif: {GIF_PATH.relative_to(ROOT)}")
        if args.capture_lead_deep:
            print(f"[ok] png: {PNG_KANBAN_LUIZ_DETAILS.relative_to(ROOT)}")
            print(f"[ok] png: {PNG_REPORT_LUIZ_TOP.relative_to(ROOT)}")
            print(f"[ok] png: {PNG_REPORT_LUIZ_S1.relative_to(ROOT)}")
            print(f"[ok] png: {PNG_REPORT_LUIZ_S2.relative_to(ROOT)}")
            print(f"[ok] png: {PNG_REPORT_LUIZ_S3.relative_to(ROOT)}")
            print(f"[ok] png: {PNG_REPORT_LUIZ_S4.relative_to(ROOT)}")
            print(f"[ok] png: {PNG_REPORT_LUIZ_S5.relative_to(ROOT)}")
            print(f"[ok] png: {PNG_REPORT_LUIZ_S6.relative_to(ROOT)}")
        return 0
    except Exception as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1
    finally:
        safe_stop(proc)


if __name__ == "__main__":
    raise SystemExit(main())
