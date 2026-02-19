import csv
import psycopg2
import os

def seed():
    conn_str = "postgresql://postgres:postgres@localhost:5432/growth_equestre"
    try:
        conn = psycopg2.connect(conn_str)
        cur = conn.cursor()
        
        # Check current count
        cur.execute("SELECT COUNT(*) FROM partners;")
        before_count = cur.fetchone()[0]
        print(f"Registros em partners antes da carga: {before_count}")

        file_path = 'data/partners_demo.csv'
        with open(file_path, encoding='utf-8') as f:
            reader = csv.DictReader(f)
            rows = []
            for r in reader:
                # Basic cleaning: handle empty strings for municipio_cod
                m_cod = r.get('municipio_cod')
                if not m_cod or m_cod.strip() == '':
                    m_cod = None
                
                rows.append((
                    r['cnpj'], 
                    r['uf'], 
                    r['razao_social'], 
                    r['nome_fantasia'],
                    m_cod,
                    r['municipio_nome'],
                    r['cnae_principal'], 
                    r['segmento'], 
                    int(r['prioridade'] or 2)
                ))
        
        # Inserção com ON CONFLICT
        # Nota: cnpj é UNIQUE, id é auto-gerado
        cur.executemany('''
            INSERT INTO partners(cnpj, uf, razao_social, nome_fantasia, municipio_cod,
                                 municipio_nome, cnae_principal, segmento, prioridade)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (cnpj) DO NOTHING
        ''', rows)
        
        conn.commit()
        
        # Check count after
        cur.execute("SELECT COUNT(*) FROM partners;")
        after_count = cur.fetchone()[0]
        print(f"Carga concluída. Registros adicionados (exclando conflitos): {after_count - before_count}")
        print(f"Total de registros em partners: {after_count}")
        
        cur.close()
        conn.close()
        
    except Exception as e:
        print(f"Erro ao popular banco: {e}")

if __name__ == "__main__":
    seed()
