import argparse
import csv
import json
import re
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List
from urllib.parse import urlencode, urljoin

import requests
from bs4 import BeautifulSoup

BASE = "https://concla.ibge.gov.br/"
SEARCH_PATH = "busca-online-cnae.html"
CNAE_RE = re.compile(r"\b\d{4}-\d(?:/\d{2})?\b")


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


def fetch_hits(keyword: str, timeout: int, sleep_s: float) -> List[CnaeHit]:
    url = build_search_url(keyword)
    headers = {"User-Agent": "Mozilla/5.0 (compatible; GrowthEquestreBot/1.0)"}
    r = requests.get(url, headers=headers, timeout=timeout)
    r.raise_for_status()
    r.encoding = r.apparent_encoding or r.encoding
    time.sleep(sleep_s)
    return parse_hits(r.text)


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
    ap.add_argument("--out", default="cnae_map.csv", help="CSV de saída (separador ;)")

    ap.add_argument("--timeout", type=int, default=20)
    ap.add_argument("--sleep", type=float, default=0.35, help="Delay entre requests (evita bloqueio)")
    ap.add_argument("--max-per-keyword", type=int, default=50, help="Limita resultados por keyword")

    ap.add_argument("--cache-dir", default="cache_cnae", help="Pasta de cache local (json por keyword)")
    args = ap.parse_args()

    cache_dir = Path(args.cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    keywords = load_keywords(args.inp)
    if not keywords:
        raise SystemExit(f"Nenhuma keyword válida encontrada em: {args.inp}")

    output_rows = []
    dedup = set()  # (segmento, cnae, uf)

    for item in keywords:
        segmento = item["segmento"]
        keyword = item["keyword"]
        prioridade = item["prioridade"]
        uf = item["uf"]

        cache_key = re.sub(r"[^a-zA-Z0-9_-]+", "_", f"{segmento}__{keyword}".lower())
        cache_path = cache_dir / f"{cache_key}.json"

        if cache_path.exists():
            hits_data = json.loads(cache_path.read_text(encoding="utf-8"))
            hits = [CnaeHit(**h) for h in hits_data]
        else:
            hits = fetch_hits(keyword, timeout=args.timeout, sleep_s=args.sleep)
            hits = hits[: args.max_per_keyword]
            cache_path.write_text(
                json.dumps([asdict(h) for h in hits], ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

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

    def sort_key(r):
        try:
            p = int(r["prioridade"])
        except:
            p = 99
        return (r["segmento"], p, r["cnae"])

    output_rows.sort(key=sort_key)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with open(out_path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["segmento", "keyword", "prioridade", "uf", "cnae", "descricao", "fonte", "url_detalhe"])
        for r in output_rows:
            w.writerow([r[k] for k in ["segmento", "keyword", "prioridade", "uf", "cnae", "descricao", "fonte", "url_detalhe"]])

    print(f"OK: {out_path} | linhas: {len(output_rows)} | cache: {cache_dir}")


if __name__ == "__main__":
    main()
