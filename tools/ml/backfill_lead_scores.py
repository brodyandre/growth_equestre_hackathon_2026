#!/usr/bin/env python3
"""
Backfill lead scores and diagnostics in batch.

This script recalculates score for multiple leads by calling:
  POST /leads/{id}/score

Default behavior:
- Reads lead IDs directly from Postgres via `docker compose exec db psql`.
- Processes leads in descending `created_at` order.
- Prints per-lead result and final summary.

Examples:
  python tools/ml/backfill_lead_scores.py
  python tools/ml/backfill_lead_scores.py --only-missing
  python tools/ml/backfill_lead_scores.py --limit 100
  python tools/ml/backfill_lead_scores.py --dry-run --limit 20
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Iterable, List, Optional


@dataclass
class BackfillResult:
    lead_id: str
    ok: bool
    status_code: int
    score: Optional[int] = None
    status: Optional[str] = None
    engine: Optional[str] = None
    model_name: Optional[str] = None
    probability: Optional[float] = None
    error: Optional[str] = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Recalculate lead score + diagnostics in batch.",
    )
    parser.add_argument(
        "--backend-url",
        default="http://localhost:3000",
        help="Base URL of backend API.",
    )
    parser.add_argument(
        "--db-service",
        default="db",
        help="Docker Compose service name for Postgres.",
    )
    parser.add_argument(
        "--db-user",
        default="app",
        help="Postgres user.",
    )
    parser.add_argument(
        "--db-name",
        default="appdb",
        help="Postgres database name.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Max number of leads to process (0 = no limit).",
    )
    parser.add_argument(
        "--only-missing",
        action="store_true",
        help="Process only leads with missing score diagnostics columns.",
    )
    parser.add_argument(
        "--lead-id",
        action="append",
        default=[],
        help="Specific lead ID to process (can be repeated). Skips DB discovery.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List lead IDs without calling scoring endpoint.",
    )
    parser.add_argument(
        "--sleep-ms",
        type=int,
        default=0,
        help="Delay in milliseconds between requests.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=20.0,
        help="HTTP timeout in seconds for each scoring request.",
    )
    parser.add_argument(
        "--fail-fast",
        action="store_true",
        help="Stop on first scoring error.",
    )
    return parser.parse_args()


def run_command(cmd: List[str]) -> str:
    """Run shell command and return stdout or raise with stderr details."""
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        stderr = (proc.stderr or "").strip()
        stdout = (proc.stdout or "").strip()
        details = stderr or stdout or "unknown error"
        raise RuntimeError(f"Command failed: {' '.join(cmd)}\n{details}")
    return proc.stdout


def build_sql(limit: int, only_missing: bool) -> str:
    """Build SQL to discover lead IDs for batch scoring."""
    where_clause = "TRUE"
    if only_missing:
        where_clause = (
            "(score_engine IS NULL OR score_model_name IS NULL "
            "OR score_probability IS NULL OR score_scored_at IS NULL)"
        )

    limit_clause = f"LIMIT {limit}" if limit > 0 else ""
    return (
        "SELECT id "
        "FROM leads "
        f"WHERE {where_clause} "
        "ORDER BY created_at DESC "
        f"{limit_clause};"
    )


def discover_lead_ids(args: argparse.Namespace) -> List[str]:
    """
    Discover lead IDs directly from Postgres via docker compose.

    Using DB lookup avoids API pagination limits and guarantees full backfill coverage.
    """
    if args.lead_id:
        return [x.strip() for x in args.lead_id if str(x).strip()]

    sql = build_sql(limit=args.limit, only_missing=args.only_missing)
    cmd = [
        "docker",
        "compose",
        "exec",
        "-T",
        args.db_service,
        "psql",
        "-U",
        args.db_user,
        "-d",
        args.db_name,
        "-At",
        "-c",
        sql,
    ]

    out = run_command(cmd)
    lead_ids = [line.strip() for line in out.replace("\r", "").split("\n") if line.strip()]

    if args.limit > 0:
        lead_ids = lead_ids[: args.limit]
    return lead_ids


def post_score(backend_url: str, lead_id: str, timeout: float) -> BackfillResult:
    """Call scoring endpoint for one lead and normalize output."""
    base = backend_url.rstrip("/")
    path = f"/leads/{urllib.parse.quote(lead_id)}/score"
    url = f"{base}{path}"

    req = urllib.request.Request(url=url, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status_code = int(resp.status)
            body_raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        body_raw = e.read().decode("utf-8", errors="replace")
        return BackfillResult(
            lead_id=lead_id,
            ok=False,
            status_code=int(e.code),
            error=body_raw.strip() or str(e),
        )
    except Exception as e:  # pragma: no cover
        return BackfillResult(
            lead_id=lead_id,
            ok=False,
            status_code=0,
            error=str(e),
        )

    try:
        payload = json.loads(body_raw)
    except json.JSONDecodeError:
        return BackfillResult(
            lead_id=lead_id,
            ok=False,
            status_code=status_code,
            error=f"Invalid JSON response: {body_raw[:300]}",
        )

    meta = payload.get("meta") if isinstance(payload, dict) else {}
    diagnostics = payload.get("diagnostics") if isinstance(payload, dict) else {}

    if not isinstance(meta, dict):
        meta = {}
    if not isinstance(diagnostics, dict):
        diagnostics = {}

    probability = diagnostics.get("probability_qualified", meta.get("probability_qualified"))
    try:
        probability = float(probability) if probability is not None else None
    except (TypeError, ValueError):
        probability = None

    return BackfillResult(
        lead_id=lead_id,
        ok=(200 <= status_code < 300),
        status_code=status_code,
        score=payload.get("score") if isinstance(payload, dict) else None,
        status=payload.get("status") if isinstance(payload, dict) else None,
        engine=diagnostics.get("engine") or meta.get("engine"),
        model_name=diagnostics.get("model_name") or meta.get("model_name"),
        probability=probability,
        error=None,
    )


def fmt_probability(probability: Optional[float]) -> str:
    if probability is None:
        return "-"
    return f"{probability * 100:.2f}%"


def print_result(idx: int, total: int, result: BackfillResult) -> None:
    prefix = f"[{idx}/{total}]"
    if result.ok:
        print(
            f"{prefix} OK  lead={result.lead_id} "
            f"score={result.score} status={result.status} "
            f"engine={result.engine or '-'} model={result.model_name or '-'} "
            f"prob={fmt_probability(result.probability)}"
        )
        return

    err = (result.error or "unknown error").replace("\n", " ").strip()
    if len(err) > 220:
        err = err[:220] + "..."
    print(
        f"{prefix} ERR lead={result.lead_id} status_code={result.status_code} error={err}",
        file=sys.stderr,
    )


def backfill(lead_ids: Iterable[str], args: argparse.Namespace) -> int:
    lead_ids = list(lead_ids)
    total = len(lead_ids)
    if total == 0:
        print("No leads found for backfill.")
        return 0

    print("Backfill configuration:")
    print(f"- backend_url: {args.backend_url}")
    print(f"- total_leads: {total}")
    print(f"- dry_run: {args.dry_run}")
    print(f"- sleep_ms: {args.sleep_ms}")

    success = 0
    failed = 0
    started = time.time()

    for idx, lead_id in enumerate(lead_ids, start=1):
        if args.dry_run:
            print(f"[{idx}/{total}] DRY lead={lead_id}")
            success += 1
            continue

        result = post_score(args.backend_url, lead_id, timeout=args.timeout)
        print_result(idx, total, result)

        if result.ok:
            success += 1
        else:
            failed += 1
            if args.fail_fast:
                break

        if args.sleep_ms > 0 and idx < total:
            time.sleep(args.sleep_ms / 1000.0)

    elapsed = time.time() - started
    print("\nSummary:")
    print(f"- success: {success}")
    print(f"- failed: {failed}")
    print(f"- elapsed_sec: {elapsed:.2f}")

    return 1 if failed > 0 else 0


def main() -> int:
    args = parse_args()

    try:
        lead_ids = discover_lead_ids(args)
    except Exception as e:
        print(f"Error discovering lead IDs: {e}", file=sys.stderr)
        return 2

    return backfill(lead_ids, args)


if __name__ == "__main__":
    raise SystemExit(main())
