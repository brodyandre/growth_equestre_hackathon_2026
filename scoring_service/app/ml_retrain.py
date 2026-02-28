from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

import pandas as pd
import psycopg
from psycopg.rows import dict_row
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import GridSearchCV, StratifiedKFold, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

TARGET_COL = "label_qualified"
NUMERIC_FEATURES = [
    "n_events",
    "n_page_view",
    "n_hook_complete",
    "n_cta_click",
    "recency_last_event_hours",
]
CATEGORICAL_FEATURES = [
    "uf",
    "cidade",
    "segmento_interesse",
    "orcamento_faixa",
    "prazo_compra",
]
FEATURE_COLS = NUMERIC_FEATURES + CATEGORICAL_FEATURES

TRAINING_SQL = """
WITH event_agg AS (
  SELECT
    lead_id,
    COUNT(*)::int AS n_events,
    COUNT(*) FILTER (WHERE event_type = 'page_view')::int AS n_page_view,
    COUNT(*) FILTER (WHERE event_type = 'hook_complete')::int AS n_hook_complete,
    COUNT(*) FILTER (WHERE event_type IN ('cta_click', 'whatsapp_click'))::int AS n_cta_click,
    EXTRACT(EPOCH FROM (now() - MAX(ts))) / 3600.0 AS recency_last_event_hours
  FROM events
  GROUP BY lead_id
)
SELECT
  l.id AS lead_id,
  COALESCE(l.uf, '') AS uf,
  COALESCE(l.cidade, '') AS cidade,
  COALESCE(l.segmento_interesse, '') AS segmento_interesse,
  COALESCE(l.orcamento_faixa, '') AS orcamento_faixa,
  COALESCE(l.prazo_compra, '') AS prazo_compra,
  COALESCE(l.status, 'CURIOSO') AS status,
  COALESCE(e.n_events, 0) AS n_events,
  COALESCE(e.n_page_view, 0) AS n_page_view,
  COALESCE(e.n_hook_complete, 0) AS n_hook_complete,
  COALESCE(e.n_cta_click, 0) AS n_cta_click,
  COALESCE(e.recency_last_event_hours, 9999) AS recency_last_event_hours,
  CASE
    WHEN UPPER(COALESCE(l.status, '')) IN ('QUALIFICADO', 'ENVIADO') THEN 1
    ELSE 0
  END AS label_qualified
FROM leads l
LEFT JOIN event_agg e ON e.lead_id = l.id
"""


@dataclass
class RetrainArtifacts:
    best_model: Any
    runner_up_model: Any
    winner_id: str
    runner_up_id: str
    cv_folds: int
    dataset_rows: int
    class_balance: Dict[str, float]
    report: Dict[str, Any]


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            return value
    return value


def _normalize_db_url(value: str) -> str:
    raw = str(value or "").strip()
    if raw.startswith("postgres://"):
        return "postgresql://" + raw[len("postgres://") :]
    return raw


def fetch_training_dataset(database_url: str) -> pd.DataFrame:
    db_url = _normalize_db_url(database_url)
    if not db_url:
        raise ValueError("SCORING_TRAIN_DATABASE_URL nao configurada.")

    with psycopg.connect(db_url) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(TRAINING_SQL)
            rows = cur.fetchall()

    if not rows:
        return pd.DataFrame(columns=["lead_id", "status", TARGET_COL] + FEATURE_COLS)

    df = pd.DataFrame(rows)
    for col in NUMERIC_FEATURES:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df[TARGET_COL] = pd.to_numeric(df[TARGET_COL], errors="coerce").fillna(0).astype(int).clip(0, 1)
    return df


def _build_pipelines(seed: int) -> Tuple[Pipeline, Pipeline]:
    preprocess_logit = ColumnTransformer(
        transformers=[
            (
                "num",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="median")),
                        ("scaler", StandardScaler()),
                    ]
                ),
                NUMERIC_FEATURES,
            ),
            (
                "cat",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        ("onehot", OneHotEncoder(handle_unknown="ignore")),
                    ]
                ),
                CATEGORICAL_FEATURES,
            ),
        ]
    )

    preprocess_rf = ColumnTransformer(
        transformers=[
            (
                "num",
                Pipeline(steps=[("imputer", SimpleImputer(strategy="median"))]),
                NUMERIC_FEATURES,
            ),
            (
                "cat",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        ("onehot", OneHotEncoder(handle_unknown="ignore")),
                    ]
                ),
                CATEGORICAL_FEATURES,
            ),
        ]
    )

    pipe_logit = Pipeline(
        steps=[
            ("prep", preprocess_logit),
            (
                "model",
                LogisticRegression(
                    max_iter=2500,
                    solver="liblinear",
                    random_state=seed,
                ),
            ),
        ]
    )

    pipe_rf = Pipeline(
        steps=[
            ("prep", preprocess_rf),
            (
                "model",
                RandomForestClassifier(
                    random_state=seed,
                    n_jobs=-1,
                ),
            ),
        ]
    )
    return pipe_logit, pipe_rf


def _base_grids(search_mode: str) -> Tuple[Dict[str, List[Any]], Dict[str, List[Any]]]:
    mode = str(search_mode or "quick").strip().lower()
    if mode == "full":
        return (
            {
                "model__C": [0.1, 0.5, 1.0, 2.0, 5.0],
                "model__penalty": ["l1", "l2"],
                "model__class_weight": [None, "balanced"],
            },
            {
                "model__n_estimators": [200, 400, 700],
                "model__max_depth": [None, 8, 16],
                "model__min_samples_split": [2, 5, 10],
                "model__min_samples_leaf": [1, 2, 4],
                "model__class_weight": [None, "balanced", "balanced_subsample"],
            },
        )

    return (
        {
            "model__C": [0.05, 0.1, 0.5, 1.0],
            "model__penalty": ["l1", "l2"],
            "model__class_weight": [None, "balanced"],
        },
        {
            "model__n_estimators": [250, 500],
            "model__max_depth": [None, 10, 18],
            "model__min_samples_split": [2, 5],
            "model__min_samples_leaf": [1, 2],
            "model__class_weight": [None, "balanced_subsample"],
        },
    )


def _run_grid_search(
    estimator: Pipeline,
    param_grid: Dict[str, List[Any]],
    cv: StratifiedKFold,
    x_train: pd.DataFrame,
    y_train: pd.Series,
) -> GridSearchCV:
    gs = GridSearchCV(
        estimator=estimator,
        param_grid=param_grid,
        scoring="roc_auc",
        cv=cv,
        n_jobs=-1,
        verbose=0,
        refit=True,
    )
    gs.fit(x_train, y_train)
    return gs


def _build_fine_grid_logit(best_params: Dict[str, Any]) -> Dict[str, List[Any]]:
    c_value = float(best_params["model__C"])
    c_candidates = sorted(
        {
            max(1e-4, round(v, 5))
            for v in [c_value * 0.5, c_value * 0.75, c_value, c_value * 1.25, c_value * 1.5]
        }
    )
    return {
        "model__C": c_candidates,
        "model__penalty": [best_params["model__penalty"]],
        "model__class_weight": [best_params["model__class_weight"], "balanced"],
    }


def _build_fine_grid_rf(best_params: Dict[str, Any]) -> Dict[str, List[Any]]:
    n_estimators = int(best_params["model__n_estimators"])
    max_depth = best_params["model__max_depth"]
    min_split = int(best_params["model__min_samples_split"])
    min_leaf = int(best_params["model__min_samples_leaf"])

    n_estimators_candidates = sorted({max(100, n_estimators - 150), n_estimators, n_estimators + 150})
    depth_candidates: List[Any] = [max_depth]
    if isinstance(max_depth, int):
        depth_candidates = sorted({max(3, max_depth - 4), max_depth, max_depth + 4})

    return {
        "model__n_estimators": n_estimators_candidates,
        "model__max_depth": depth_candidates,
        "model__min_samples_split": sorted({max(2, min_split - 1), min_split, min_split + 1}),
        "model__min_samples_leaf": sorted({max(1, min_leaf - 1), min_leaf, min_leaf + 1}),
        "model__class_weight": [best_params["model__class_weight"], "balanced_subsample"],
    }


def _evaluate_model(
    model_name: str,
    estimator: Pipeline,
    x_valid: pd.DataFrame,
    y_valid: pd.Series,
    x_test: pd.DataFrame,
    y_test: pd.Series,
) -> Dict[str, Any]:
    start = datetime.now(timezone.utc)
    p_valid = estimator.predict_proba(x_valid)[:, 1]
    val_latency_ms = (
        (datetime.now(timezone.utc) - start).total_seconds() * 1000 / max(1, len(x_valid))
    )

    start = datetime.now(timezone.utc)
    p_test = estimator.predict_proba(x_test)[:, 1]
    test_latency_ms = (
        (datetime.now(timezone.utc) - start).total_seconds() * 1000 / max(1, len(x_test))
    )

    yhat_valid = (p_valid >= 0.5).astype(int)
    yhat_test = (p_test >= 0.5).astype(int)

    return {
        "model": model_name,
        "val_roc_auc": float(roc_auc_score(y_valid, p_valid)),
        "val_pr_auc": float(average_precision_score(y_valid, p_valid)),
        "val_brier": float(brier_score_loss(y_valid, p_valid)),
        "val_f1": float(f1_score(y_valid, yhat_valid, zero_division=0)),
        "val_precision": float(precision_score(y_valid, yhat_valid, zero_division=0)),
        "val_recall": float(recall_score(y_valid, yhat_valid, zero_division=0)),
        "val_latency_ms": float(val_latency_ms),
        "test_roc_auc": float(roc_auc_score(y_test, p_test)),
        "test_pr_auc": float(average_precision_score(y_test, p_test)),
        "test_brier": float(brier_score_loss(y_test, p_test)),
        "test_f1": float(f1_score(y_test, yhat_test, zero_division=0)),
        "test_precision": float(precision_score(y_test, yhat_test, zero_division=0)),
        "test_recall": float(recall_score(y_test, yhat_test, zero_division=0)),
        "test_latency_ms": float(test_latency_ms),
    }


def _select_winner(results_df: pd.DataFrame) -> Tuple[str, List[str]]:
    eps_auc = 0.005
    eps_pr = 0.003
    eps_brier = 0.002

    ranked = results_df.sort_values(["val_roc_auc", "val_pr_auc"], ascending=[False, False]).reset_index(
        drop=True
    )
    first = ranked.iloc[0]
    second = ranked.iloc[1]

    reasons: List[str] = []
    if (first["val_roc_auc"] - second["val_roc_auc"]) > eps_auc:
        reasons.append("Vencedor por ROC-AUC.")
        return str(first["model"]), reasons

    reasons.append("Empate tecnico em ROC-AUC; desempate por PR-AUC.")
    if (first["val_pr_auc"] - second["val_pr_auc"]) > eps_pr:
        reasons.append("Vencedor por PR-AUC.")
        return str(first["model"]), reasons

    reasons.append("Empate tecnico em PR-AUC; desempate por Brier.")
    if (second["val_brier"] - first["val_brier"]) > eps_brier:
        reasons.append("Vencedor por menor Brier score.")
        return str(first["model"]), reasons

    reasons.append("Empate tecnico em Brier; desempate por latencia.")
    if first["val_latency_ms"] <= second["val_latency_ms"]:
        reasons.append("Vencedor por menor latencia.")
        return str(first["model"]), reasons

    reasons.append("Vencedor por menor latencia (segundo modelo).")
    return str(second["model"]), reasons


def train_models_from_dataframe(
    df: pd.DataFrame,
    *,
    random_state: int = 42,
    search_mode: str = "quick",
) -> RetrainArtifacts:
    if df is None or df.empty:
        raise ValueError("Base de treino vazia. Gere leads antes de retreinar.")

    missing = set(FEATURE_COLS).difference(df.columns)
    if missing:
        raise ValueError(f"Base de treino sem colunas obrigatorias: {sorted(missing)}")

    work_df = df.copy()
    if TARGET_COL not in work_df.columns:
        if "status" not in work_df.columns:
            raise ValueError("Base sem label_qualified e sem status para derivar target.")
        work_df[TARGET_COL] = (
            work_df["status"].astype(str).str.upper().isin(["QUALIFICADO", "ENVIADO"]).astype(int)
        )

    for c in NUMERIC_FEATURES:
        work_df[c] = pd.to_numeric(work_df[c], errors="coerce")
    work_df[TARGET_COL] = pd.to_numeric(work_df[TARGET_COL], errors="coerce").fillna(0).astype(int).clip(0, 1)
    work_df = work_df.dropna(subset=[TARGET_COL]).copy()

    if work_df[TARGET_COL].nunique() < 2:
        raise ValueError("Base com apenas uma classe no target. Gere mais leads com status diferentes.")

    x = work_df[FEATURE_COLS].copy()
    y = work_df[TARGET_COL].astype(int)

    try:
        x_train, x_temp, y_train, y_temp = train_test_split(
            x,
            y,
            test_size=0.30,
            stratify=y,
            random_state=random_state,
        )
        x_valid, x_test, y_valid, y_test = train_test_split(
            x_temp,
            y_temp,
            test_size=0.50,
            stratify=y_temp,
            random_state=random_state,
        )
    except ValueError as exc:
        raise ValueError(f"Falha no split estratificado: {exc}") from exc

    class_min_count = int(y_train.value_counts().min())
    cv_splits = max(2, min(5, class_min_count))
    cv = StratifiedKFold(n_splits=cv_splits, shuffle=True, random_state=random_state)

    pipe_logit, pipe_rf = _build_pipelines(seed=random_state)
    base_grid_logit, base_grid_rf = _base_grids(search_mode)

    gs_logit = _run_grid_search(pipe_logit, base_grid_logit, cv, x_train, y_train)
    gs_rf = _run_grid_search(pipe_rf, base_grid_rf, cv, x_train, y_train)

    fine_logit = _run_grid_search(
        pipe_logit,
        _build_fine_grid_logit(gs_logit.best_params_),
        cv,
        x_train,
        y_train,
    )
    fine_rf = _run_grid_search(
        pipe_rf,
        _build_fine_grid_rf(gs_rf.best_params_),
        cv,
        x_train,
        y_train,
    )

    metrics = [
        _evaluate_model("logit_fine", fine_logit.best_estimator_, x_valid, y_valid, x_test, y_test),
        _evaluate_model("rf_fine", fine_rf.best_estimator_, x_valid, y_valid, x_test, y_test),
    ]
    results_df = pd.DataFrame(metrics).sort_values("val_roc_auc", ascending=False).reset_index(drop=True)
    winner_name, winner_reasons = _select_winner(results_df)
    runner_up_name = [m for m in ["logit_fine", "rf_fine"] if m != winner_name][0]

    model_map = {
        "logit_fine": fine_logit.best_estimator_,
        "rf_fine": fine_rf.best_estimator_,
    }

    class_counts = y.value_counts().to_dict()
    class_balance = {
        "rows": int(len(work_df)),
        "qualified_ratio": float(y.mean()),
        "qualified_count": int(class_counts.get(1, 0)),
        "non_qualified_count": int(class_counts.get(0, 0)),
    }

    report = {
        "winner": winner_name,
        "runner_up": runner_up_name,
        "selection_reasons": winner_reasons,
        "metrics": _json_safe(results_df.to_dict(orient="records")),
        "best_params": _json_safe(
            {
                "logit_fine": fine_logit.best_params_,
                "rf_fine": fine_rf.best_params_,
            }
        ),
        "target_col": TARGET_COL,
        "feature_cols": FEATURE_COLS,
        "random_state": int(random_state),
        "search_mode": str(search_mode or "quick"),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "dataset": class_balance,
    }

    return RetrainArtifacts(
        best_model=model_map[winner_name],
        runner_up_model=model_map[runner_up_name],
        winner_id=winner_name,
        runner_up_id=runner_up_name,
        cv_folds=cv_splits,
        dataset_rows=int(len(work_df)),
        class_balance=class_balance,
        report=report,
    )
