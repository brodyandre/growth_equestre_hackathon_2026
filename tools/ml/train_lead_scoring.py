#!/usr/bin/env python3
"""
Train dual lead-scoring models with GridSearchCV + fine tuning.

Outputs:
- lead_scoring_best_model.joblib
- lead_scoring_runner_up_model.joblib
- model_selection_report.json
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Dict, List, Tuple

import joblib
import pandas as pd
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

RANDOM_STATE = 42
TARGET_COL = "label_qualified"

# Features numéricas derivadas de comportamento no funil.
NUMERIC_FEATURES = [
    "n_events",
    "n_page_view",
    "n_hook_complete",
    "n_cta_click",
    "recency_last_event_hours",
]

# Features categóricas de perfil/contexto do lead.
CATEGORICAL_FEATURES = [
    "uf",
    "cidade",
    "segmento_interesse",
    "orcamento_faixa",
    "prazo_compra",
]

FEATURE_COLS = NUMERIC_FEATURES + CATEGORICAL_FEATURES


def parse_args() -> argparse.Namespace:
    """Define e parseia argumentos de linha de comando do treino."""
    parser = argparse.ArgumentParser(description="Train dual ML models for lead scoring.")
    parser.add_argument(
        "--input-csv",
        default="data/ml/lead_scoring_dataset.csv",
        help="Path to training CSV.",
    )
    parser.add_argument(
        "--output-dir",
        default="data/ml/artifacts",
        help="Directory for model artifacts and report.",
    )
    parser.add_argument(
        "--random-state",
        type=int,
        default=RANDOM_STATE,
        help="Random seed.",
    )
    return parser.parse_args()


def load_dataset(path: Path) -> pd.DataFrame:
    """
    Carrega e valida o dataset de treino.

    Regras:
    - Exige colunas mínimas de features.
    - Deriva TARGET_COL a partir de status quando necessário.
    - Garante target binário com duas classes para viabilizar treino.
    """
    if not path.exists():
        raise FileNotFoundError(f"Input CSV not found: {path}")

    # Leitura bruta do CSV gerado pelo pipeline SQL.
    df = pd.read_csv(path)
    missing = set(FEATURE_COLS).difference(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {sorted(missing)}")

    # Se a label não veio pronta, deriva de status comercial.
    if TARGET_COL not in df.columns:
        if "status" not in df.columns:
            raise ValueError("Dataset missing target 'label_qualified' and fallback 'status'.")
        df[TARGET_COL] = (
            df["status"].astype(str).str.upper().isin(["QUALIFICADO", "ENVIADO"]).astype(int)
        )

    # Coerção segura de numéricos; valores inválidos viram NaN para imputação posterior.
    for c in NUMERIC_FEATURES:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    # Remove linhas sem target e protege contra treino com classe única.
    df = df.dropna(subset=[TARGET_COL]).copy()
    if df[TARGET_COL].nunique() < 2:
        raise ValueError(
            "Target has one class only. Generate more demo data with positive and negative labels."
        )
    return df


def build_pipelines(seed: int) -> Tuple[Pipeline, Pipeline]:
    """
    Monta pipelines de pré-processamento + modelo.

    Estratégia:
    - Regressão logística: imputa + escala numéricos + one-hot em categóricos.
    - Random forest: imputa numéricos (sem escala) + one-hot em categóricos.
    """
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


def run_grid_search(
    name: str,
    estimator: Pipeline,
    param_grid: Dict[str, List],
    cv: StratifiedKFold,
    x_train: pd.DataFrame,
    y_train: pd.Series,
) -> GridSearchCV:
    """Executa GridSearchCV padronizado com ROC-AUC como métrica principal."""
    print(f"\n>>> {name}: GridSearchCV")
    gs = GridSearchCV(
        estimator=estimator,
        param_grid=param_grid,
        scoring="roc_auc",
        cv=cv,
        n_jobs=-1,
        verbose=1,
        refit=True,
    )
    gs.fit(x_train, y_train)
    print(f"Best ROC-AUC CV ({name}): {gs.best_score_:.4f}")
    print(f"Best params ({name}): {gs.best_params_}")
    return gs


def build_fine_grid_logit(best_params: Dict[str, object]) -> Dict[str, List[object]]:
    """
    Gera grade refinada para regressão logística a partir do melhor ponto da busca base.
    """
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


def build_fine_grid_rf(best_params: Dict[str, object]) -> Dict[str, List[object]]:
    """
    Gera grade refinada para random forest em torno dos melhores hiperparâmetros.
    """
    n_estimators = int(best_params["model__n_estimators"])
    max_depth = best_params["model__max_depth"]
    min_split = int(best_params["model__min_samples_split"])
    min_leaf = int(best_params["model__min_samples_leaf"])

    n_estimators_candidates = sorted({max(100, n_estimators - 150), n_estimators, n_estimators + 150})
    depth_candidates = [max_depth]
    if isinstance(max_depth, int):
        depth_candidates = sorted({max(3, max_depth - 4), max_depth, max_depth + 4})

    return {
        "model__n_estimators": n_estimators_candidates,
        "model__max_depth": depth_candidates,
        "model__min_samples_split": sorted({max(2, min_split - 1), min_split, min_split + 1}),
        "model__min_samples_leaf": sorted({max(1, min_leaf - 1), min_leaf, min_leaf + 1}),
        "model__class_weight": [best_params["model__class_weight"], "balanced_subsample"],
    }


def evaluate_estimator(
    name: str,
    estimator: Pipeline,
    x_valid: pd.DataFrame,
    y_valid: pd.Series,
    x_test: pd.DataFrame,
    y_test: pd.Series,
) -> Dict[str, float | str]:
    """
    Avalia um estimador em validação e teste.

    Além das métricas clássicas, mede latência média por registro, que é usada no desempate.
    """
    # Latência e probabilidade no conjunto de validação.
    start = time.perf_counter()
    p_valid = estimator.predict_proba(x_valid)[:, 1]
    valid_latency_ms = (time.perf_counter() - start) * 1000 / max(1, len(x_valid))

    # Latência e probabilidade no conjunto de teste.
    start = time.perf_counter()
    p_test = estimator.predict_proba(x_test)[:, 1]
    test_latency_ms = (time.perf_counter() - start) * 1000 / max(1, len(x_test))

    # Corte padrão de classificação binária.
    yhat_valid = (p_valid >= 0.5).astype(int)
    yhat_test = (p_test >= 0.5).astype(int)

    return {
        "model": name,
        "val_roc_auc": float(roc_auc_score(y_valid, p_valid)),
        "val_pr_auc": float(average_precision_score(y_valid, p_valid)),
        "val_brier": float(brier_score_loss(y_valid, p_valid)),
        "val_f1": float(f1_score(y_valid, yhat_valid, zero_division=0)),
        "val_precision": float(precision_score(y_valid, yhat_valid, zero_division=0)),
        "val_recall": float(recall_score(y_valid, yhat_valid, zero_division=0)),
        "val_latency_ms": float(valid_latency_ms),
        "test_roc_auc": float(roc_auc_score(y_test, p_test)),
        "test_pr_auc": float(average_precision_score(y_test, p_test)),
        "test_brier": float(brier_score_loss(y_test, p_test)),
        "test_f1": float(f1_score(y_test, yhat_test, zero_division=0)),
        "test_precision": float(precision_score(y_test, yhat_test, zero_division=0)),
        "test_recall": float(recall_score(y_test, yhat_test, zero_division=0)),
        "test_latency_ms": float(test_latency_ms),
    }


def select_winner(results_df: pd.DataFrame) -> Tuple[str, List[str]]:
    """
    Seleciona campeão com regra de desempate em cascata.

    Ordem:
    1) ROC-AUC
    2) PR-AUC
    3) Brier (menor melhor)
    4) Latência (menor melhor)
    """
    eps_auc = 0.005
    eps_pr = 0.003
    eps_brier = 0.002
    ranked = results_df.sort_values(["val_roc_auc", "val_pr_auc"], ascending=[False, False]).reset_index(drop=True)
    first = ranked.iloc[0]
    second = ranked.iloc[1]

    reasons: List[str] = []
    if (first["val_roc_auc"] - second["val_roc_auc"]) > eps_auc:
        reasons.append("Winner by ROC-AUC without technical tie.")
        return str(first["model"]), reasons

    reasons.append("Technical tie on ROC-AUC; applying PR-AUC tie-break.")
    if (first["val_pr_auc"] - second["val_pr_auc"]) > eps_pr:
        reasons.append("Winner by PR-AUC.")
        return str(first["model"]), reasons

    reasons.append("Technical tie on PR-AUC; applying Brier tie-break.")
    if (second["val_brier"] - first["val_brier"]) > eps_brier:
        reasons.append("Winner by lower Brier score.")
        return str(first["model"]), reasons

    reasons.append("Technical tie on Brier score; applying inference latency tie-break.")
    if first["val_latency_ms"] <= second["val_latency_ms"]:
        reasons.append("Winner by lower latency.")
        return str(first["model"]), reasons

    reasons.append("Winner by lower latency (second model).")
    return str(second["model"]), reasons


def main() -> None:
    """Fluxo completo: carregar dados, treinar, comparar, eleger e salvar artefatos."""
    args = parse_args()
    csv_path = Path(args.input_csv)
    output_dir = Path(args.output_dir)
    # Garante diretório de saída antes de qualquer escrita de artefato.
    output_dir.mkdir(parents=True, exist_ok=True)

    df = load_dataset(csv_path)
    print(f"Loaded dataset rows: {len(df)}")
    print("Class ratio:")
    print(df[TARGET_COL].value_counts(normalize=True).round(4))

    x = df[FEATURE_COLS].copy()
    y = df[TARGET_COL].astype(int)

    # Split 70/15/15 (treino/validação/teste), mantendo balanceamento de classes.
    x_train, x_temp, y_train, y_temp = train_test_split(
        x,
        y,
        test_size=0.30,
        stratify=y,
        random_state=args.random_state,
    )
    x_valid, x_test, y_valid, y_test = train_test_split(
        x_temp,
        y_temp,
        test_size=0.50,
        stratify=y_temp,
        random_state=args.random_state,
    )

    # Ajuste dinâmico do número de folds para evitar erro com datasets pequenos.
    class_min_count = int(y_train.value_counts().min())
    cv_splits = max(2, min(5, class_min_count))
    cv = StratifiedKFold(n_splits=cv_splits, shuffle=True, random_state=args.random_state)
    print(f"CV folds selected: {cv_splits}")

    pipe_logit, pipe_rf = build_pipelines(seed=args.random_state)

    base_grid_logit = {
        "model__C": [0.1, 0.5, 1.0, 2.0, 5.0],
        "model__penalty": ["l1", "l2"],
        "model__class_weight": [None, "balanced"],
    }
    base_grid_rf = {
        "model__n_estimators": [200, 400, 700],
        "model__max_depth": [None, 8, 16],
        "model__min_samples_split": [2, 5, 10],
        "model__min_samples_leaf": [1, 2, 4],
        "model__class_weight": [None, "balanced", "balanced_subsample"],
    }

    # Rodada 1: busca ampla de hiperparâmetros.
    gs_logit = run_grid_search("LogisticRegression", pipe_logit, base_grid_logit, cv, x_train, y_train)
    gs_rf = run_grid_search("RandomForest", pipe_rf, base_grid_rf, cv, x_train, y_train)

    # Rodada 2 (fine tuning): busca local em torno dos melhores pontos.
    fine_grid_logit = build_fine_grid_logit(gs_logit.best_params_)
    fine_grid_rf = build_fine_grid_rf(gs_rf.best_params_)

    fine_logit = run_grid_search(
        "LogisticRegression (fine)",
        pipe_logit,
        fine_grid_logit,
        cv,
        x_train,
        y_train,
    )
    fine_rf = run_grid_search(
        "RandomForest (fine)",
        pipe_rf,
        fine_grid_rf,
        cv,
        x_train,
        y_train,
    )

    # Avalia apenas os melhores modelos da rodada refinada.
    metrics = [
        evaluate_estimator("logit_fine", fine_logit.best_estimator_, x_valid, y_valid, x_test, y_test),
        evaluate_estimator("rf_fine", fine_rf.best_estimator_, x_valid, y_valid, x_test, y_test),
    ]
    results_df = pd.DataFrame(metrics).sort_values("val_roc_auc", ascending=False).reset_index(drop=True)
    winner_name, winner_reasons = select_winner(results_df)
    runner_up_name = [m for m in ["logit_fine", "rf_fine"] if m != winner_name][0]

    # Mapa para persistir campeão e vice com nomes estáveis.
    model_map = {
        "logit_fine": fine_logit.best_estimator_,
        "rf_fine": fine_rf.best_estimator_,
    }

    best_model_path = output_dir / "lead_scoring_best_model.joblib"
    runner_up_model_path = output_dir / "lead_scoring_runner_up_model.joblib"
    report_path = output_dir / "model_selection_report.json"

    # Persistência dos dois modelos (campeão e fallback técnico).
    joblib.dump(model_map[winner_name], best_model_path)
    joblib.dump(model_map[runner_up_name], runner_up_model_path)

    # Relatório de auditoria para reproducibilidade e pitch técnico.
    report = {
        "winner": winner_name,
        "runner_up": runner_up_name,
        "selection_reasons": winner_reasons,
        "metrics": results_df.to_dict(orient="records"),
        "best_params": {
            "logit_fine": fine_logit.best_params_,
            "rf_fine": fine_rf.best_params_,
        },
        "target_col": TARGET_COL,
        "feature_cols": FEATURE_COLS,
        "random_state": args.random_state,
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n=== Training Summary ===")
    print(results_df.to_string(index=False))
    print(f"\nWinner: {winner_name}")
    for reason in winner_reasons:
        print(f"- {reason}")
    print("\nArtifacts:")
    print(f"- {best_model_path}")
    print(f"- {runner_up_model_path}")
    print(f"- {report_path}")


if __name__ == "__main__":
    main()
