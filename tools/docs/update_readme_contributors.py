#!/usr/bin/env python3
"""
Update README section "Contribuidores Autorizados no GitHub" automatically.

Data source:
- GitHub REST API contributors endpoint for the target repository.

The script keeps/updates:
- Index item 18 in the README.
- Section 18 scaffold and contributor list block between markers.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Iterable


INDEX_ITEM = "- [18. Contribuidores Autorizados no GitHub](#18-contribuidores-autorizados-no-github)"
SECTION_ANCHOR = '<a id="18-contribuidores-autorizados-no-github"></a>'
START_MARKER = "<!-- CONTRIBUTORS:START -->"
END_MARKER = "<!-- CONTRIBUTORS:END -->"


@dataclass
class Contributor:
    login: str
    html_url: str
    contributions: int
    name: str = ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Atualiza a seção 18 de contribuidores no README."
    )
    parser.add_argument(
        "--readme",
        default="README.md",
        help="Caminho do README a ser atualizado (default: README.md).",
    )
    parser.add_argument(
        "--repo",
        default=os.getenv("GITHUB_REPOSITORY", "").strip(),
        help="Repositório no formato owner/repo (default: GITHUB_REPOSITORY).",
    )
    parser.add_argument(
        "--token",
        default=os.getenv("GITHUB_TOKEN", "").strip(),
        help="Token GitHub (default: GITHUB_TOKEN).",
    )
    parser.add_argument(
        "--min-contributions",
        type=int,
        default=1,
        help="Número mínimo de contribuições para listar (default: 1).",
    )
    parser.add_argument(
        "--include-bots",
        action="store_true",
        help="Inclui contas bot na listagem.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Mostra prévia sem gravar arquivo.",
    )
    return parser.parse_args()


def _http_get_json(url: str, token: str) -> tuple[object, dict[str, str]]:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "growth-equestre-readme-contributors-bot",
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
        method="GET",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = resp.read().decode("utf-8")
            data = json.loads(payload)
            headers = {k: v for k, v in resp.headers.items()}
            return data, headers
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:  # pragma: no cover
            body = "<sem corpo de erro>"
        raise RuntimeError(f"Erro HTTP {exc.code} ao acessar {url}: {body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Erro de rede ao acessar {url}: {exc}") from exc


def _next_link(link_header: str) -> str:
    if not link_header:
        return ""
    for part in link_header.split(","):
        section = part.strip()
        if 'rel="next"' in section:
            match = re.search(r"<([^>]+)>", section)
            if match:
                return match.group(1)
    return ""


def fetch_contributors(
    repo: str, token: str, min_contributions: int, include_bots: bool
) -> list[Contributor]:
    if not repo or "/" not in repo:
        raise ValueError(
            "Repositorio invalido. Informe --repo no formato owner/repo ou defina GITHUB_REPOSITORY."
        )

    contributors: dict[str, Contributor] = {}
    base = f"https://api.github.com/repos/{repo}/contributors?per_page=100"
    url = base

    while url:
        data, headers = _http_get_json(url, token)
        if not isinstance(data, list):
            raise RuntimeError(
                "Resposta inesperada da API de contributors (esperado array)."
            )

        for item in data:
            if not isinstance(item, dict):
                continue

            login = str(item.get("login") or "").strip()
            if not login:
                continue
            if not include_bots and login.endswith("[bot]"):
                continue

            ctype = str(item.get("type") or "").strip()
            if ctype and ctype.lower() not in {"user", "organization"}:
                continue

            count = int(item.get("contributions") or 0)
            if count < min_contributions:
                continue

            html_url = str(item.get("html_url") or f"https://github.com/{login}").strip()
            prev = contributors.get(login)
            if prev is None or count > prev.contributions:
                contributors[login] = Contributor(
                    login=login,
                    html_url=html_url,
                    contributions=count,
                )

        url = _next_link(headers.get("Link", ""))

    result = sorted(
        contributors.values(),
        key=lambda c: (-c.contributions, c.login.lower()),
    )
    return result


def enrich_names(contributors: Iterable[Contributor], token: str) -> None:
    for c in contributors:
        url = f"https://api.github.com/users/{urllib.parse.quote(c.login)}"
        try:
            data, _ = _http_get_json(url, token)
            if isinstance(data, dict):
                name = str(data.get("name") or "").strip()
                c.name = name
        except RuntimeError:
            # Name enrichment is best-effort; keep login when unavailable.
            continue


def ensure_index_item(readme_text: str) -> str:
    if INDEX_ITEM in readme_text:
        return readme_text

    match = re.search(r"(?m)^- \[17\.[^\n]*\n", readme_text)
    if match:
        insert_pos = match.end()
        return readme_text[:insert_pos] + INDEX_ITEM + "\n" + readme_text[insert_pos:]

    # fallback: append item after heading "## Índice" block when 17 isn't found
    idx_match = re.search(r"(?m)^##\s+Índice\s*$", readme_text)
    if idx_match:
        tail = readme_text[idx_match.end() :]
        nl = tail.find("\n")
        if nl >= 0:
            pos = idx_match.end() + nl + 1
            return readme_text[:pos] + INDEX_ITEM + "\n" + readme_text[pos:]

    return readme_text


def ensure_section_scaffold(readme_text: str) -> str:
    if SECTION_ANCHOR in readme_text and START_MARKER in readme_text and END_MARKER in readme_text:
        return readme_text

    section = (
        "\n\n---\n\n"
        f"{SECTION_ANCHOR}\n\n"
        "## 18. Contribuidores Autorizados no GitHub\n\n"
        "[![Voltar ao Indice](https://img.shields.io/badge/%E2%AC%86%EF%B8%8F-Voltar%20ao%20%C3%8Dndice-0b5fff?style=for-the-badge)](#indice)\n\n"
        "Esta seção é atualizada automaticamente pela automação do repositório, listando os usuários que contribuíram no GitHub para este projeto.\n\n"
        f"{START_MARKER}\n"
        "- Atualizando automaticamente...\n"
        f"{END_MARKER}\n"
    )
    return readme_text.rstrip() + section + "\n"


def build_markdown_lines(contributors: list[Contributor]) -> list[str]:
    if not contributors:
        return ["- Nenhum contribuidor encontrado no momento."]

    lines = ["<!-- Gerado automaticamente por tools/docs/update_readme_contributors.py -->"]
    for c in contributors:
        name_suffix = f" - {c.name}" if c.name and c.name.lower() != c.login.lower() else ""
        lines.append(
            f"- [@{c.login}]({c.html_url}){name_suffix} - {c.contributions} contribuicoes"
        )
    return lines


def replace_between_markers(readme_text: str, lines: list[str]) -> str:
    pattern = re.compile(
        re.escape(START_MARKER) + r".*?" + re.escape(END_MARKER),
        flags=re.DOTALL,
    )
    replacement = START_MARKER + "\n" + "\n".join(lines) + "\n" + END_MARKER
    if not pattern.search(readme_text):
        raise RuntimeError("Marcadores CONTRIBUTORS nao encontrados no README.")
    return pattern.sub(replacement, readme_text, count=1)


def main() -> int:
    args = parse_args()

    readme_path = args.readme
    if not os.path.isfile(readme_path):
        print(f"README nao encontrado: {readme_path}", file=sys.stderr)
        return 1

    with open(readme_path, "r", encoding="utf-8") as f:
        original = f.read()

    text = ensure_index_item(original)
    text = ensure_section_scaffold(text)

    contributors = fetch_contributors(
        repo=args.repo,
        token=args.token,
        min_contributions=max(1, args.min_contributions),
        include_bots=args.include_bots,
    )
    enrich_names(contributors, args.token)
    lines = build_markdown_lines(contributors)
    updated = replace_between_markers(text, lines)

    if updated == original:
        print("README ja esta atualizado.")
        return 0

    if args.dry_run:
        print("README seria atualizado com os contribuidores abaixo:\n")
        for line in lines:
            print(line)
        return 0

    with open(readme_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(updated)

    print(f"README atualizado com {len(contributors)} contribuidor(es).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
