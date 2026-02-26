#!/usr/bin/env python3
"""
Capture updated README screenshots for the main UI Node.js screens:
- overview (dashboard)
- create-lead-demos
- leads
- leads (scroll evidence)
- kanban
- partners
- partners (scroll evidence)
- settings
- settings (training output)
- create-lead (result and pitch scenario)

Usage (from repo root):
  python tools/docs/capture_ui_core_screens.py --ui-url http://127.0.0.1:3100
  python tools/docs/capture_ui_core_screens.py --ui-url http://127.0.0.1:3200 --start-server --capture-create-deep
  python tools/docs/capture_ui_core_screens.py --ui-url http://127.0.0.1:3200 --start-server --capture-retrain-result
  python tools/docs/capture_ui_core_screens.py --ui-url http://127.0.0.1:3100 --capture-overview-deep
  python tools/docs/capture_ui_core_screens.py --ui-url http://127.0.0.1:3100 --only-leads-partners --capture-leads-deep --capture-partners-deep
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

from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as ec
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "docs" / "readme_images"
PNG_OVERVIEW = OUT_DIR / "ui-visao-geral.png"
PNG_OVERVIEW_SCROLL_1 = OUT_DIR / "ui-visao-geral-rolagem-1.png"
PNG_OVERVIEW_SCROLL_2 = OUT_DIR / "ui-visao-geral-rolagem-2.png"
PNG_CREATE = OUT_DIR / "ui-criar-lead-demos.png"
PNG_CREATE_RESULT = OUT_DIR / "ui-criar-lead-demos-resultado.png"
PNG_CREATE_PITCH = OUT_DIR / "ui-criar-lead-demos-roteiro.png"
PNG_LEADS = OUT_DIR / "ui-leads.png"
PNG_LEADS_SCROLL_1 = OUT_DIR / "ui-leads-rolagem-1.png"
PNG_LEADS_SCROLL_2 = OUT_DIR / "ui-leads-rolagem-2.png"
PNG_KANBAN = OUT_DIR / "ui-crm-kanban.png"
PNG_PARTNERS = OUT_DIR / "ui-parceiros.png"
PNG_PARTNERS_SCROLL_1 = OUT_DIR / "ui-parceiros-rolagem-1.png"
PNG_PARTNERS_SCROLL_2 = OUT_DIR / "ui-parceiros-rolagem-2.png"
PNG_SETTINGS = OUT_DIR / "ui-configuracoes.png"
PNG_SETTINGS_RETRAIN = OUT_DIR / "ui-configuracoes-retreino-resultado.png"


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


def capture_viewport_png(driver: webdriver.Chrome, output_path: Path) -> None:
    ok = driver.save_screenshot(str(output_path))
    if not ok:
        raise RuntimeError(f"Falha ao capturar screenshot: {output_path.name}")


def wait_page_ready(driver: webdriver.Chrome, wait: WebDriverWait, path: str, selector: str) -> None:
    driver.get(path)
    wait.until(ec.presence_of_element_located((By.CSS_SELECTOR, selector)))
    driver.execute_script("window.scrollTo(0, 0);")
    # Small delay for async UI hydration.
    time.sleep(0.35)


def open_first_kanban_lead_details(driver: webdriver.Chrome, wait: WebDriverWait) -> None:
    # Board can be loaded from backend or fallback mock. Try to open details when possible.
    for _ in range(8):
        try:
            clicked = driver.execute_script(
                """
                const btn = document.querySelector("button[data-action='open-details']");
                if (!btn) return false;
                btn.click();
                return true;
                """
            )
            if clicked:
                wait.until(ec.presence_of_element_located((By.ID, "dOpenReportBtn")))
                time.sleep(0.2)
                return
        except Exception:
            # Ignore transient rendering races and retry.
            pass
        time.sleep(0.4)


def capture_overview_deep(driver: webdriver.Chrome, wait: WebDriverWait) -> None:
    wait.until(ec.presence_of_element_located((By.ID, "kpiLeads")))
    # Use a shorter viewport to ensure visible vertical scroll captures.
    original_size = driver.get_window_size()
    try:
        driver.set_window_size(1920, 760)
        driver.execute_script("window.scrollTo(0, 0);")
        time.sleep(0.25)

        # Mid scroll: modelo/acoes/resumo por status.
        mid_anchor = driver.find_element(By.ID, "dashboardTable")
        driver.execute_script("arguments[0].scrollIntoView({block: 'start'});", mid_anchor)
        time.sleep(0.35)
        capture_viewport_png(driver, PNG_OVERVIEW_SCROLL_1)

        # Deep scroll: bloco de parceiros (filtro + KPIs + tabela).
        partner_anchor = driver.find_element(By.ID, "overviewPartnersTable")
        driver.execute_script("arguments[0].scrollIntoView({block: 'start'});", partner_anchor)
        time.sleep(0.35)
        capture_viewport_png(driver, PNG_OVERVIEW_SCROLL_2)
    finally:
        driver.set_window_size(original_size.get("width", 1920), original_size.get("height", 1080))


def capture_leads_deep(driver: webdriver.Chrome, wait: WebDriverWait) -> None:
    wait.until(ec.presence_of_element_located((By.CSS_SELECTOR, "#leadsTable tbody tr")))

    # Evidence 1: internal vertical scroll in table window.
    driver.execute_script(
        """
        const t = document.getElementById('leadsTable');
        if (!t) return;
        const maxScroll = Math.max(0, t.scrollHeight - t.clientHeight);
        t.scrollTop = Math.floor(maxScroll * 0.6);
        """
    )
    time.sleep(0.35)
    capture_viewport_png(driver, PNG_LEADS_SCROLL_1)

    # Evidence 2: lower section (details + actions) with selection.
    selected = driver.execute_script(
        """
        const sel = document.getElementById('leadActionSelect');
        if (!sel) return false;
        const next = Array.from(sel.options || []).find((o) => o.value);
        if (!next) return false;
        sel.value = next.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
        """
    )
    if selected:
        wait.until(ec.presence_of_element_located((By.CSS_SELECTOR, "#leadDetailWrap table")))
    action_anchor = driver.find_element(By.ID, "leadActionSelect")
    driver.execute_script("arguments[0].scrollIntoView({block: 'start'});", action_anchor)
    time.sleep(0.35)
    capture_viewport_png(driver, PNG_LEADS_SCROLL_2)


def capture_partners_deep(driver: webdriver.Chrome, wait: WebDriverWait) -> None:
    wait.until(ec.presence_of_element_located((By.CSS_SELECTOR, "#partnersTable tbody tr[data-partner-id]")))

    # Evidence 1: internal vertical scroll in table window.
    driver.execute_script(
        """
        const t = document.getElementById('partnersTable');
        if (!t) return;
        const maxScroll = Math.max(0, t.scrollHeight - t.clientHeight);
        t.scrollTop = Math.floor(maxScroll * 0.6);
        """
    )
    time.sleep(0.35)
    capture_viewport_png(driver, PNG_PARTNERS_SCROLL_1)

    # Evidence 2: lower section (partner details block).
    detail_anchor = driver.find_element(By.ID, "partnerDetailSelect")
    driver.execute_script("arguments[0].scrollIntoView({block: 'start'});", detail_anchor)
    time.sleep(0.35)
    capture_viewport_png(driver, PNG_PARTNERS_SCROLL_2)


def capture_create_lead_result_and_pitch(driver: webdriver.Chrome, wait: WebDriverWait) -> None:
    wait.until(ec.element_to_be_clickable((By.ID, "clQuickQualificado")))

    # 1) Generate a quick QUALIFICADO lead and capture the "Resultado" card.
    driver.find_element(By.ID, "clQuickQualificado").click()
    wait.until(ec.presence_of_element_located((By.CSS_SELECTOR, "#clResultCard[style*='display: block']")))
    wait.until(ec.presence_of_element_located((By.CSS_SELECTOR, "#clScoreKpis .kpi-box")))

    result_card = driver.find_element(By.ID, "clResultCard")
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", result_card)
    time.sleep(0.4)
    capture_viewport_png(driver, PNG_CREATE_RESULT)

    # 2) Run pitch scenario and capture the generated summary table.
    pitch_btn = wait.until(ec.element_to_be_clickable((By.ID, "clPitchScenarioBtn")))
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", pitch_btn)
    time.sleep(0.2)
    pitch_btn.click()

    wait.until(ec.presence_of_element_located((By.CSS_SELECTOR, "#clPitchSummary[style*='display: block'] table")))
    pitch_summary = driver.find_element(By.ID, "clPitchSummary")
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", pitch_summary)
    time.sleep(0.4)
    capture_viewport_png(driver, PNG_CREATE_PITCH)


def capture_settings_retrain_result(driver: webdriver.Chrome, wait: WebDriverWait) -> None:
    wait.until(ec.presence_of_element_located((By.ID, "btnMlRetrainRun")))
    driver.execute_script(
        "document.getElementById('mlExpectedLeads').value = '3000';"
        "document.getElementById('mlRandomSeed').value = '42';"
    )
    ignore_mismatch = driver.find_element(By.ID, "mlIgnoreExpectedMismatch")
    if not ignore_mismatch.is_selected():
        ignore_mismatch.click()

    confirm = driver.find_element(By.ID, "mlRetrainConfirmRun")
    if not confirm.is_selected():
        confirm.click()

    run_btn = wait.until(ec.element_to_be_clickable((By.ID, "btnMlRetrainRun")))
    run_btn.click()

    long_wait = WebDriverWait(driver, 300)

    def retrain_done(drv: webdriver.Chrome) -> bool:
        notice = drv.find_element(By.ID, "mlRetrainNotice").text.lower()
        has_table = len(drv.find_elements(By.CSS_SELECTOR, "#mlRetrainResult table")) > 0
        if has_table:
            return True
        if "falha" in notice:
            return True
        if "concluido" in notice or "concluído" in notice:
            return True
        return False

    long_wait.until(retrain_done)
    result_wrap = driver.find_element(By.ID, "mlRetrainResult")
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", result_wrap)
    time.sleep(0.4)
    capture_viewport_png(driver, PNG_SETTINGS_RETRAIN)


def capture_assets(
    ui_url: str,
    capture_retrain_result: bool = False,
    capture_create_deep: bool = False,
    capture_overview_deep_flag: bool = False,
    capture_leads_deep_flag: bool = False,
    capture_partners_deep_flag: bool = False,
    only_overview: bool = False,
    only_leads_partners: bool = False,
) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--window-size=1920,1080")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")

    driver = webdriver.Chrome(options=opts)
    wait = WebDriverWait(driver, 25)
    base = ui_url.rstrip("/")
    try:
        if not only_leads_partners:
            wait_page_ready(driver, wait, f"{base}/", "#kpiLeads")
            capture_viewport_png(driver, PNG_OVERVIEW)
            if capture_overview_deep_flag:
                capture_overview_deep(driver, wait)
            if only_overview:
                return

        wait_page_ready(driver, wait, f"{base}/leads", "#leadsTable")
        capture_viewport_png(driver, PNG_LEADS)
        if capture_leads_deep_flag:
            capture_leads_deep(driver, wait)

        wait_page_ready(driver, wait, f"{base}/partners", "#partnersTable")
        capture_viewport_png(driver, PNG_PARTNERS)
        if capture_partners_deep_flag:
            capture_partners_deep(driver, wait)
        if only_leads_partners:
            return

        wait_page_ready(driver, wait, f"{base}/create-lead-demos", "#createLeadDemoForm")
        capture_viewport_png(driver, PNG_CREATE)
        if capture_create_deep:
            capture_create_lead_result_and_pitch(driver, wait)

        wait_page_ready(driver, wait, f"{base}/kanban", "#kanbanRoot")
        open_first_kanban_lead_details(driver, wait)
        capture_viewport_png(driver, PNG_KANBAN)

        wait_page_ready(driver, wait, f"{base}/settings", "#btnMlRetrainRun")
        capture_viewport_png(driver, PNG_SETTINGS)
        if capture_retrain_result:
            capture_settings_retrain_result(driver, wait)
    finally:
        driver.quit()


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture UI core screenshots for README.")
    parser.add_argument("--ui-url", default="http://127.0.0.1:3200", help="Base URL of ui_web.")
    parser.add_argument(
        "--start-server",
        action="store_true",
        help="Start ui_web/server.js automatically if the URL is not already healthy.",
    )
    parser.add_argument(
        "--capture-retrain-result",
        action="store_true",
        help="Executa o retreinamento via UI e captura o resultado em screenshot dedicado.",
    )
    parser.add_argument(
        "--capture-create-deep",
        action="store_true",
        help="Captura evidencias da guia Criar lead: card de resultado e roteiro de demo executado.",
    )
    parser.add_argument(
        "--capture-overview-deep",
        action="store_true",
        help="Captura evidencias adicionais da 8.2.1 (Visao geral) em rolagem.",
    )
    parser.add_argument(
        "--capture-leads-deep",
        action="store_true",
        help="Captura evidencias adicionais da 8.2.3 (Leads) em rolagem.",
    )
    parser.add_argument(
        "--capture-partners-deep",
        action="store_true",
        help="Captura evidencias adicionais da 8.2.5 (Parceiros) em rolagem.",
    )
    parser.add_argument(
        "--only-overview",
        action="store_true",
        help="Captura apenas a guia Visao geral e encerra.",
    )
    parser.add_argument(
        "--only-leads-partners",
        action="store_true",
        help="Captura apenas as guias Leads e Parceiros e encerra.",
    )
    args = parser.parse_args()
    if args.only_overview and args.only_leads_partners:
        raise ValueError("Use apenas um modo: --only-overview OU --only-leads-partners.")

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

        capture_assets(
            ui_url,
            capture_retrain_result=args.capture_retrain_result,
            capture_create_deep=args.capture_create_deep,
            capture_overview_deep_flag=args.capture_overview_deep,
            capture_leads_deep_flag=args.capture_leads_deep,
            capture_partners_deep_flag=args.capture_partners_deep,
            only_overview=args.only_overview,
            only_leads_partners=args.only_leads_partners,
        )
        if not args.only_leads_partners:
            print(f"[ok] {PNG_OVERVIEW.relative_to(ROOT)}")
            if args.capture_overview_deep:
                print(f"[ok] {PNG_OVERVIEW_SCROLL_1.relative_to(ROOT)}")
                print(f"[ok] {PNG_OVERVIEW_SCROLL_2.relative_to(ROOT)}")
            if args.only_overview:
                return 0
        print(f"[ok] {PNG_LEADS.relative_to(ROOT)}")
        if args.capture_leads_deep:
            print(f"[ok] {PNG_LEADS_SCROLL_1.relative_to(ROOT)}")
            print(f"[ok] {PNG_LEADS_SCROLL_2.relative_to(ROOT)}")
        print(f"[ok] {PNG_PARTNERS.relative_to(ROOT)}")
        if args.capture_partners_deep:
            print(f"[ok] {PNG_PARTNERS_SCROLL_1.relative_to(ROOT)}")
            print(f"[ok] {PNG_PARTNERS_SCROLL_2.relative_to(ROOT)}")
        if args.only_leads_partners:
            return 0
        print(f"[ok] {PNG_CREATE.relative_to(ROOT)}")
        if args.capture_create_deep:
            print(f"[ok] {PNG_CREATE_RESULT.relative_to(ROOT)}")
            print(f"[ok] {PNG_CREATE_PITCH.relative_to(ROOT)}")
        print(f"[ok] {PNG_KANBAN.relative_to(ROOT)}")
        print(f"[ok] {PNG_SETTINGS.relative_to(ROOT)}")
        if args.capture_retrain_result:
            print(f"[ok] {PNG_SETTINGS_RETRAIN.relative_to(ROOT)}")
        return 0
    except Exception as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1
    finally:
        safe_stop(proc)


if __name__ == "__main__":
    raise SystemExit(main())
