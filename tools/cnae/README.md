# Scraper CNAE

Script para coletar códigos CNAE do site CONCLA/IBGE com robustez, cache e rate limiting.

## Instalação de Dependências

```bash
# Dentro do ambiente virtual
pip install -r requirements.txt
```

Ou instale manualmente:

```bash
pip install requests beautifulsoup4 lxml
```

## Uso Básico

```bash
python generate_cnae_map.py --in cnae_keywords.csv
```

## Argumentos Disponíveis

| Argumento | Padrão | Descrição |
|-----------|--------|-----------|
| `--in` | *(obrigatório)* | CSV de entrada (segmento;keyword;prioridade;uf) |
| `--out` | `data/cnae/cnae_map.csv` | CSV de saída |
| `--rate-limit-rpm` | 60 | Requests por minuto |
| `--min-delay` | 0.5 | Delay mínimo entre requests (segundos) |
| `--max-per-keyword` | 50 | Limita resultados por keyword |
| `--batch-size` | 0 | Tamanho do lote (0 = todos) |
| `--max-retries` | 3 | Máximo de tentativas por request |
| `--cache-dir` | `data/cnae/raw` | Diretório de cache/raw |
| `--force-refresh` | - | Ignora cache e força refresh |
| `--verbose` | - | Ativa logs detalhados |

## Exemplos

### Rate limiting conservador
```bash
python generate_cnae_map.py --in cnae_keywords.csv --rate-limit-rpm 30 --min-delay 1.0
```

### Processar apenas 5 keywords
```bash
python generate_cnae_map.py --in cnae_keywords.csv --batch-size 5
```

### Ignorar cache e reprocessar tudo
```bash
python generate_cnae_map.py --in cnae_keywords.csv --force-refresh --verbose
```

## Estrutura de Saída

```
data/cnae/
├── cnae_map.csv           # CSV consolidado
├── errors.log             # Log de erros (se houver)
└── raw/                   # Cache e HTML raw
    ├── keyword1/
    │   ├── data.json      # Cache processado
    │   └── *.html         # HTML raw com timestamp
    └── keyword2/
        └── ...
```

## Funcionalidades

- ✅ **Rate limiting**: Controla RPM para evitar bloqueio
- ✅ **Retry com backoff**: Até 3 tentativas com delay exponencial
- ✅ **Cache local**: JSON processado + HTML raw
- ✅ **Batch processing**: Processa keywords em lotes
- ✅ **Error logging**: Log detalhado de erros
- ✅ **Progress tracking**: Contador e resumo final
