"""
Script de teste para validar o scraper CNAE melhorado.
Testa rate limiting, cache, retry e estrutura de diretórios.
"""
import subprocess
import sys
import time
from pathlib import Path


def run_command(cmd: list, description: str) -> tuple[bool, str]:
    """Run a command and return success status and output."""
    print(f"\n{'='*60}")
    print(f"Teste: {description}")
    print(f"{'='*60}")
    print(f"Comando: {' '.join(cmd)}")
    print()
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding='utf-8',
            timeout=120
        )
        
        print(result.stdout)
        if result.stderr:
            print("STDERR:", result.stderr)
        
        success = result.returncode == 0
        print(f"\n{'✓' if success else '✗'} Resultado: {'SUCESSO' if success else 'FALHA'}")
        
        return success, result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        print("✗ TIMEOUT: Comando excedeu 120 segundos")
        return False, "timeout"
    except Exception as e:
        print(f"✗ ERRO: {e}")
        return False, str(e)


def check_structure():
    """Verificar se a estrutura de diretórios foi criada."""
    print(f"\n{'='*60}")
    print("Verificando estrutura de diretórios")
    print(f"{'='*60}")
    
    base_dir = Path("c:/growth_equestre_hackathon_2026/data/cnae")
    
    checks = [
        (base_dir, "Diretório base data/cnae/"),
        (base_dir / "cnae_map.csv", "Arquivo de saída cnae_map.csv"),
        (base_dir / "raw", "Diretório de cache/raw"),
    ]
    
    all_good = True
    for path, description in checks:
        exists = path.exists()
        symbol = "✓" if exists else "✗"
        print(f"{symbol} {description}: {path}")
        if not exists:
            all_good = False
    
    # Check for keyword subdirectories in raw/
    if (base_dir / "raw").exists():
        subdirs = list((base_dir / "raw").iterdir())
        if subdirs:
            print(f"\n✓ Encontrados {len(subdirs)} subdiretórios em raw/:")
            for subdir in subdirs[:3]:  # Show first 3
                files = list(subdir.glob("*"))
                print(f"  - {subdir.name}/ ({len(files)} arquivos)")
                for f in files[:2]:  # Show first 2 files
                    print(f"    • {f.name}")
        else:
            print("\n⚠ Nenhum subdiretório encontrado em raw/")
    
    return all_good


def main():
    print("\n" + "="*60)
    print("TESTE DO SCRAPER CNAE - ROBUSTEZ + CACHE + RATE LIMIT")
    print("="*60)
    
    base_path = Path("c:/growth_equestre_hackathon_2026")
    script_path = base_path / "tools/cnae/generate_cnae_map.py"
    input_csv = base_path / "tools/cnae/cnae_keywords.csv"
    
    # Verificar se arquivos existem
    if not script_path.exists():
        print(f"✗ Script não encontrado: {script_path}")
        return 1
    
    if not input_csv.exists():
        print(f"✗ CSV de entrada não encontrado: {input_csv}")
        return 1
    
    print(f"✓ Script encontrado: {script_path}")
    print(f"✓ CSV de entrada encontrado: {input_csv}")
    
    # Teste 1: Execução completa com rate limiting
    success1, output1 = run_command(
        [
            sys.executable, str(script_path),
            "--in", str(input_csv),
            "--rate-limit-rpm", "30",  # Limite conservador
            "--min-delay", "0.5",
            "--verbose"
        ],
        "Execução completa com rate limiting"
    )
    
    # Verificar estrutura
    structure_ok = check_structure()
    
    # Teste 2: Execução usando cache (deve ser rápida)
    print("\n\nAguardando 2 segundos antes do teste de cache...\n")
    time.sleep(2)
    
    start_time = time.time()
    success2, output2 = run_command(
        [
            sys.executable, str(script_path),
            "--in", str(input_csv),
        ],
        "Execução usando cache (deve ser rápida)"
    )
    cache_duration = time.time() - start_time
    
    # Teste 3: Force refresh de 3 keywords
    success3, output3 = run_command(
        [
            sys.executable, str(script_path),
            "--in", str(input_csv),
            "--batch-size", "3",
            "--force-refresh",
            "--verbose"
        ],
        "Force refresh com batch de 3 keywords"
    )
    
    # Resumo final
    print("\n" + "="*60)
    print("RESUMO DOS TESTES")
    print("="*60)
    print(f"{'✓' if success1 else '✗'} Teste 1: Execução completa com rate limiting")
    print(f"{'✓' if structure_ok else '✗'} Teste 2: Estrutura de diretórios correta")
    print(f"{'✓' if success2 else '✗'} Teste 3: Cache funcional (duração: {cache_duration:.2f}s)")
    print(f"{'✓' if success3 else '✗'} Teste 4: Force refresh em batch")
    
    # Análise de cache
    if success2 and cache_duration < 3:
        print(f"\n✓ Cache está funcionando! Execução levou apenas {cache_duration:.2f}s")
    elif success2:
        print(f"\n⚠ Execução com cache levou {cache_duration:.2f}s (esperado < 3s)")
    
    all_success = success1 and structure_ok and success2 and success3
    
    if all_success:
        print("\n" + "="*60)
        print("✓ TODOS OS TESTES PASSARAM!")
        print("="*60)
        return 0
    else:
        print("\n" + "="*60)
        print("✗ ALGUNS TESTES FALHARAM")
        print("="*60)
        return 1


if __name__ == "__main__":
    sys.exit(main())
