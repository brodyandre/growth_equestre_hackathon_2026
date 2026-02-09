"""Gera partners.csv (MG/SP/GO) a partir de Estabelecimentos do CNPJ + CNAE seed/lookup.

Exemplo:
python jobs/build_partners_from_cnpj.py --estab data/estabelecimentos.csv --seed data/cnae_seed_mvp_mg_sp_go.csv --lookup data/cnae_lookup_subclasses_2_3_corrigido.csv --out data/partners.csv --ufs MG SP GO --sep ';'

Obs: o arquivo de estabelecimentos é grande. Use amostra no hackathon se necessário.
"""

import argparse, re
import pandas as pd
from pathlib import Path

def norm_cnae_to7(x: str) -> str:
    if pd.isna(x): return ""
    s = re.sub(r"[^0-9]", "", str(x).strip())
    return (s.zfill(7) if s else "")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--estab", required=True)
    ap.add_argument("--seed", required=True)
    ap.add_argument("--lookup", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--ufs", nargs="+", default=["MG","SP","GO"])
    ap.add_argument("--sep", default=";")
    ap.add_argument("--chunksize", type=int, default=200000)
    args = ap.parse_args()

    seed = pd.read_csv(args.seed, sep=args.sep, dtype=str)
    if "subclasse_num7" in seed.columns:
        seed7 = set(seed["subclasse_num7"].astype(str))
    else:
        seed7 = set(seed.iloc[:,0].apply(norm_cnae_to7))

    lookup = pd.read_csv(args.lookup, sep=args.sep, dtype=str)
    if "subclasse_num7" not in lookup.columns:
        raise ValueError("lookup precisa ter coluna subclasse_num7")
    lookup_map = lookup.set_index("subclasse_num7").to_dict(orient="index")

    ufs = set([u.upper() for u in args.ufs])
    out_rows = []

    # Ajuste nomes das colunas aqui se seu CSV de estabelecimentos vier com headers diferentes
    usecols = None  # deixe None para ler todas (mais lento). Melhor: defina as colunas do seu layout.

    for chunk in pd.read_csv(args.estab, sep=args.sep, dtype=str, chunksize=args.chunksize, usecols=usecols):
        if "uf" not in chunk.columns or "cnae_fiscal_principal" not in chunk.columns:
            raise ValueError("O CSV de estabelecimentos precisa ter colunas: uf, cnae_fiscal_principal (ajuste o script se seu header for diferente)")

        chunk["uf"] = chunk["uf"].str.upper()
        chunk = chunk[chunk["uf"].isin(ufs)].copy()

        chunk["cnae7"] = chunk["cnae_fiscal_principal"].apply(norm_cnae_to7)
        mask = chunk["cnae7"].isin(seed7)

        if "cnae_fiscal_secundaria" in chunk.columns:
            sec = chunk["cnae_fiscal_secundaria"].fillna("")
            mask = mask | sec.apply(lambda s: any(norm_cnae_to7(x) in seed7 for x in re.split(r"[;, ]+", str(s)) if x.strip()))

        chunk = chunk[mask].copy()

        # CNPJ 14 (ajuste se o seu layout vier com outros nomes)
        if all(c in chunk.columns for c in ["cnpj_basico","cnpj_ordem","cnpj_dv"]):
            chunk["cnpj"] = chunk["cnpj_basico"].str.zfill(8) + chunk["cnpj_ordem"].str.zfill(4) + chunk["cnpj_dv"].str.zfill(2)
        else:
            chunk["cnpj"] = ""

        for _, row in chunk.iterrows():
            info = lookup_map.get(row["cnae7"], {})
            out_rows.append({
                "cnpj": row.get("cnpj",""),
                "razao_social": None,
                "nome_fantasia": row.get("nome_fantasia"),
                "uf": row.get("uf"),
                "municipio_cod": row.get("municipio"),
                "municipio_nome": None,
                "cnae_principal": row.get("cnae7"),
                "cnaes_secundarios": row.get("cnae_fiscal_secundaria"),
                "segmento": None,
                "prioridade": 2,
                "situacao_cadastral": row.get("situacao_cadastral"),
                "data_inicio_atividade": row.get("data_inicio_atividade"),
                "contato": {"email": row.get("email")},
                "endereco": {"cep": row.get("cep")},
                "cnae_descricao": info.get("subclasse_desc") or info.get("denominacao") or ""
            })

    out = pd.DataFrame(out_rows)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(args.out, index=False, sep=";", encoding="utf-8-sig")
    print("OK ->", args.out, "| linhas:", len(out))

if __name__ == "__main__":
    main()
