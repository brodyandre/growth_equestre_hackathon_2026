import pg from "pg";

const DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/growth_equestre";
const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function verify() {
  try {
    console.log("--- Distribuição por Segmento ---");
    const resSeg = await pool.query(
      "SELECT segmento, COUNT(*) FROM partners GROUP BY segmento ORDER BY COUNT(*) DESC;",
    );
    console.table(resSeg.rows);

    console.log("\n--- Distribuição por UF ---");
    const resUf = await pool.query(
      "SELECT uf, COUNT(*) FROM partners GROUP BY uf ORDER BY uf;",
    );
    console.table(resUf.rows);

    const resTotal = await pool.query("SELECT COUNT(*) FROM partners;");
    console.log(`\nTotal Final: ${resTotal.rows[0].count}`);
  } catch (err) {
    console.error("Erro na verificação:", err);
  } finally {
    await pool.end();
  }
}

verify();
