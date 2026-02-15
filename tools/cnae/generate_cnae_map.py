import argparse
import csv
import json
import logging
import re
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlencode, urljoin

import requests
from bs4 import BeautifulSoup

BASE = "https://concla.ibge.gov.br/"
SEARCH_PATH = "busca-online-cnae.html"
CNAE_RE = re.compile(r"\b\d{4}-\d(?:/\d{2})?\b")

# Configure logging with UTF-8 encoding for Windows compatibility
handler = logging.StreamHandler(sys.stdout)
handler.setLevel(logging.INFO)
handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
# Force UTF-8 encoding on Windows
if sys.platform == "win32":
    import io
    handler.stream = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[handler]
)
logger = logging.getLogger(__name__)


class RateLimiter:
    """Controls request rate to respect rate limits."""
    
    def __init__(self, requests_per_minute: int = 60, min_delay: float = 0.5):
        self.requests_per_minute = requests_per_minute
        self.min_delay = min_delay
        self.request_times: List[float] = []
    
    def wait_if_needed(self):
        """Wait if necessary to respect rate limits."""
        now = time.time()
        
        # Remove requests older than 1 minute
        cutoff = now - 60
        self.request_times = [t for t in self.request_times if t > cutoff]
        
        # Check if we've hit the rate limit
        if len(self.request_times) >= self.requests_per_minute:
            oldest = self.request_times[0]
            sleep_time = 60 - (now - oldest) + 0.1  # Add small buffer
            if sleep_time > 0:
                logger.info(f"Rate limit reached, waiting {sleep_time:.1f}s")
                time.sleep(sleep_time)
                now = time.time()
        
        # Enforce minimum delay between requests
        if self.request_times:
            time_since_last = now - self.request_times[-1]
            if time_since_last < self.min_delay:
                time.sleep(self.min_delay - time_since_last)
                now = time.time()
        
        self.request_times.append(now)


@dataclass
class CnaeHit:
    cnae: str
    descricao: str
    url_detalhe: str


def build_search_url(keyword: str) -> str:
    params = {
        "Itemid": "6160",
        "chave": keyword,
        "option": "com_cnae",
        "view": "atividades",
    }
    return urljoin(BASE, SEARCH_PATH) + "?" + urlencode(params)


def clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip(" -–\t\r\n")


def parse_hits(html: str) -> List[CnaeHit]:
    soup = BeautifulSoup(html, "lxml")

    hits: List[CnaeHit] = []
    seen = set()

    for a in soup.find_all("a", href=True):
        t = a.get_text(" ", strip=True)
        m = CNAE_RE.search(t)
        if not m:
            continue

        cnae = m.group(0)
        url_detalhe = urljoin(BASE, a["href"])

        desc = ""
        if a.next_sibling and isinstance(a.next_sibling, str):
            desc = clean_text(a.next_sibling)

        if not desc:
            parent_text = a.parent.get_text(" ", strip=True)
            desc = clean_text(parent_text.replace(cnae, ""))

        key = (cnae, desc, url_detalhe)
        if cnae and key not in seen:
            seen.add(key)
            hits.append(CnaeHit(cnae=cnae, descricao=desc or "—", url_detalhe=url_detalhe))

    hits.sort(key=lambda x: x.cnae)
    return hits


def fetch_hits_with_retry(
    keyword: str, 
    timeout: int, 
    rate_limiter: RateLimiter,
    max_retries: int = 3
) -> Tuple[Optional[List[CnaeHit]], Optional[str]]:
    """Fetch hits with retry logic and exponential backoff.
    
    Returns:
        Tuple of (hits, html) or (None, None) if all retries failed
    """
    url = build_search_url(keyword)
    headers = {"User-Agent": "Mozilla/5.0 (compatible; GrowthEquestreBot/1.0)"}
    
    for attempt in range(max_retries):
        try:
            # Wait if needed to respect rate limits
            rate_limiter.wait_if_needed()
            
            logger.debug(f"Fetching '{keyword}' (attempt {attempt + 1}/{max_retries})")
            r = requests.get(url, headers=headers, timeout=timeout)
            
            # Handle rate limiting responses
            if r.status_code == 429:
                wait_time = min(2 ** attempt * 5, 60)  # Cap at 60s
                logger.warning(f"Rate limited (429), waiting {wait_time}s before retry")
                time.sleep(wait_time)
                continue
            
            # Handle server errors with backoff
            if r.status_code in (500, 502, 503, 504):
                wait_time = min(2 ** attempt * 2, 30)  # Cap at 30s
                logger.warning(f"Server error ({r.status_code}), waiting {wait_time}s before retry")
                time.sleep(wait_time)
                continue
            
            r.raise_for_status()
            r.encoding = r.apparent_encoding or r.encoding
            
            hits = parse_hits(r.text)
            return hits, r.text
            
        except requests.exceptions.Timeout:
            logger.warning(f"Timeout fetching '{keyword}' (attempt {attempt + 1}/{max_retries})")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
        except requests.exceptions.ConnectionError as e:
            logger.warning(f"Connection error for '{keyword}': {e} (attempt {attempt + 1}/{max_retries})")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
        except requests.exceptions.RequestException as e:
            logger.error(f"Request error for '{keyword}': {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
        except Exception as e:
            logger.error(f"Unexpected error fetching '{keyword}': {e}")
            break
    
    logger.error(f"Failed to fetch '{keyword}' after {max_retries} attempts")
    return None, None


def load_keywords(path: str) -> List[Dict[str, str]]:
    rows = []
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            segmento = (row.get("segmento") or "").strip().upper()
            keyword = (row.get("keyword") or "").strip()
            prioridade = (row.get("prioridade") or "").strip() or "3"
            uf = (row.get("uf") or "").strip().upper()
            if not segmento or not keyword:
                continue
            rows.append({"segmento": segmento, "keyword": keyword, "prioridade": prioridade, "uf": uf})
    return rows


def main():
    ap = argparse.ArgumentParser(description="Gera cnae_map.csv (segmento x CNAE) via CONCLA/IBGE.")
    ap.add_argument("--in", dest="inp", required=True, help="CSV de entrada (segmento;keyword;prioridade;uf)")
    ap.add_argument("--out", default="data/cnae/cnae_map.csv", help="CSV de saída (separador ;)")

    ap.add_argument("--timeout", type=int, default=20)
    ap.add_argument("--rate-limit-rpm", type=int, default=60, help="Requests por minuto (padrão: 60)")
    ap.add_argument("--min-delay", type=float, default=0.5, help="Delay mínimo entre requests em segundos")
    ap.add_argument("--max-per-keyword", type=int, default=50, help="Limita resultados por keyword")
    ap.add_argument("--batch-size", type=int, default=0, help="Tamanho do lote (0 = processar todos)")
    ap.add_argument("--max-retries", type=int, default=3, help="Máximo de tentativas por request")

    ap.add_argument("--cache-dir", default="data/cnae/raw", help="Pasta de cache e raw data")
    ap.add_argument("--force-refresh", action="store_true", help="Ignora cache e força refresh")
    ap.add_argument("--verbose", action="store_true", help="Ativa logs detalhados")
    
    args = ap.parse_args()

    # Configure log level
    if args.verbose:
        logger.setLevel(logging.DEBUG)
    
    # Setup directories
    cache_dir = Path(args.cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    
    error_log_path = cache_dir.parent / "errors.log"
    
    # Setup error file handler
    error_handler = logging.FileHandler(error_log_path, encoding="utf-8")
    error_handler.setLevel(logging.ERROR)
    error_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(error_handler)

    # Initialize rate limiter
    rate_limiter = RateLimiter(requests_per_minute=args.rate_limit_rpm, min_delay=args.min_delay)

    keywords = load_keywords(args.inp)
    if not keywords:
        raise SystemExit(f"Nenhuma keyword válida encontrada em: {args.inp}")

    logger.info(f"Total de keywords carregadas: {len(keywords)}")
    logger.info(f"Rate limit: {args.rate_limit_rpm} RPM, delay mínimo: {args.min_delay}s")

    # Batch processing setup
    if args.batch_size > 0:
        keywords_to_process = keywords[:args.batch_size]
        logger.info(f"Processando lote de {len(keywords_to_process)} keywords (batch-size={args.batch_size})")
    else:
        keywords_to_process = keywords
        logger.info(f"Processando todas as {len(keywords_to_process)} keywords")

    output_rows = []
    dedup = set()  # (segmento, cnae, uf)
    
    stats = {
        "total": len(keywords_to_process),
        "processed": 0,
        "cache_hits": 0,
        "fetched": 0,
        "errors": 0,
        "total_hits": 0
    }

    for idx, item in enumerate(keywords_to_process, 1):
        segmento = item["segmento"]
        keyword = item["keyword"]
        prioridade = item["prioridade"]
        uf = item["uf"]

        logger.info(f"[{idx}/{stats['total']}] Processando: {segmento} / {keyword}")

        # Create safe cache key
        cache_key = re.sub(r"[^a-zA-Z0-9_-]+", "_", f"{segmento}__{keyword}".lower())
        keyword_dir = cache_dir / cache_key
        keyword_dir.mkdir(exist_ok=True)
        
        cache_json_path = keyword_dir / "data.json"
        
        hits = None
        html_content = None

        # Try to load from cache
        if cache_json_path.exists() and not args.force_refresh:
            try:
                hits_data = json.loads(cache_json_path.read_text(encoding="utf-8"))
                hits = [CnaeHit(**h) for h in hits_data]
                stats["cache_hits"] += 1
                logger.info(f"  [OK] Cache hit: {len(hits)} resultados")
            except Exception as e:
                logger.warning(f"  [WARN] Erro ao ler cache: {e}, buscando novamente")
                hits = None

        # Fetch if not in cache
        if hits is None:
            hits, html_content = fetch_hits_with_retry(
                keyword, 
                timeout=args.timeout, 
                rate_limiter=rate_limiter,
                max_retries=args.max_retries
            )
            
            if hits is None:
                stats["errors"] += 1
                logger.error(f"  [ERRO] Falha ao buscar: {keyword}")
                continue
            
            stats["fetched"] += 1
            
            # Limit results
            hits = hits[:args.max_per_keyword]
            
            # Save to cache
            try:
                # Save JSON
                cache_json_path.write_text(
                    json.dumps([asdict(h) for h in hits], ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                
                # Save HTML raw
                if html_content:
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    html_path = keyword_dir / f"{timestamp}.html"
                    html_path.write_text(html_content, encoding="utf-8")
                    logger.debug(f"  Saved raw HTML: {html_path.name}")
                
                logger.info(f"  [OK] Fetched: {len(hits)} resultados")
            except Exception as e:
                logger.error(f"  [ERRO] Erro ao salvar cache: {e}")

        stats["processed"] += 1
        stats["total_hits"] += len(hits)

        # Add hits to output
        for h in hits:
            key = (segmento, h.cnae, uf)
            if key in dedup:
                continue
            dedup.add(key)
            output_rows.append(
                {
                    "segmento": segmento,
                    "keyword": keyword,
                    "prioridade": prioridade,
                    "uf": uf,
                    "cnae": h.cnae,
                    "descricao": h.descricao,
                    "fonte": "CONCLA/IBGE",
                    "url_detalhe": h.url_detalhe,
                }
            )

    # Sort output
    def sort_key(r):
        try:
            p = int(r["prioridade"])
        except:
            p = 99
        return (r["segmento"], p, r["cnae"])

    output_rows.sort(key=sort_key)

    # Write output CSV
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with open(out_path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["segmento", "keyword", "prioridade", "uf", "cnae", "descricao", "fonte", "url_detalhe"])
        for r in output_rows:
            w.writerow([r[k] for k in ["segmento", "keyword", "prioridade", "uf", "cnae", "descricao", "fonte", "url_detalhe"]])

    # Print summary
    logger.info("\n" + "=" * 60)
    logger.info("RESUMO DA EXECUÇÃO")
    logger.info("=" * 60)
    logger.info(f"Keywords processadas: {stats['processed']}/{stats['total']}")
    logger.info(f"Cache hits: {stats['cache_hits']}")
    logger.info(f"Fetched (novos): {stats['fetched']}")
    logger.info(f"Erros: {stats['errors']}")
    logger.info(f"Total de CNAE encontrados: {stats['total_hits']}")
    logger.info(f"Linhas únicas no output: {len(output_rows)}")
    logger.info(f"")
    logger.info(f"Output: {out_path}")
    logger.info(f"Cache/Raw: {cache_dir}")
    if stats['errors'] > 0:
        logger.info(f"Log de erros: {error_log_path}")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
