/**
 * Growth Equestre - UI Web (Node.js)
 * - Express + EJS (SSR simples, rápido para hackathon)
 * - Proxy /api/* -> BACKEND_URL (evita CORS e simplifica consumo)
 */
require("dotenv").config();

const path = require("path");
const express = require("express");
const expressLayouts = require("express-ejs-layouts");
const morgan = require("morgan");
const { createProxyMiddleware, fixRequestBody } = require("http-proxy-middleware");

const pagesRouter = require("./src/routes/pages");

const app = express();

const PORT = Number(process.env.PORT || 3100);
const BACKEND_URL = String(process.env.BACKEND_URL || "http://localhost:3000").trim().replace(/\/$/, "");
const ASSET_VERSION = String(process.env.ASSET_VERSION || "20260308");
const HEALTH_PATH = String(process.env.HEALTH_PATH || "/health");
const SUMMARY_PATH = String(process.env.SUMMARY_PATH || "/partners/summary");
const ML_MODEL_INFO_PATH = String(process.env.ML_MODEL_INFO_PATH || "/ml/model-info");
const KANBAN_PATH = String(process.env.KANBAN_PATH || "/crm/board");
const KANBAN_MOVE_PATH = String(process.env.KANBAN_MOVE_PATH || "/crm/move");
const CRM_NOTES_BASE_PATH = String(process.env.CRM_NOTES_BASE_PATH || "/crm/leads");
const CRM_MATCHES_BASE_PATH = String(process.env.CRM_MATCHES_BASE_PATH || "/crm/leads");

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "src", "views"));

app.use(expressLayouts);
app.set("layout", "layout");

app.use(morgan("dev"));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/css", express.static(path.join(__dirname, "public", "css")));
app.use("/js", express.static(path.join(__dirname, "public", "js")));

// Vars globais para os templates
app.use((req, res, next) => {
  res.locals.APP_NAME = "Growth Equestre";
  res.locals.BACKEND_URL = BACKEND_URL;
  res.locals.ASSET_VERSION = ASSET_VERSION;
  res.locals.currentPath = req.path;
  res.locals.paths = {
    health: HEALTH_PATH,
    summary: SUMMARY_PATH,
    mlModelInfo: ML_MODEL_INFO_PATH,
    kanban: KANBAN_PATH,
    kanbanMove: KANBAN_MOVE_PATH,
    crmNotesBase: CRM_NOTES_BASE_PATH,
    crmMatchesBase: CRM_MATCHES_BASE_PATH,
  };
  next();
});

// Proxy: tudo que entrar em /api vai para o backend, removendo o prefixo /api
app.use(
  "/api",
  createProxyMiddleware({
    target: BACKEND_URL,
    changeOrigin: true,
    pathRewrite: { "^/api": "" },
    logLevel: process.env.PROXY_LOG_LEVEL || "warn",
    on: {
      // Necessario quando o body ja foi parseado pelo express.json()
      // antes de passar pelo proxy.
      proxyReq: fixRequestBody,
    },
  })
);

app.get("/health-ui", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "ui-web",
    backend_url: BACKEND_URL,
  });
});

app.use("/", pagesRouter);

// 404
app.use((req, res) => {
  res.status(404).render("pages/404", { title: "Não encontrado" });
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[ui-web:error]", err);
  res.status(500).render("pages/500", { title: "Erro", error: err });
});

function startServer(basePort, maxRetries = 10) {
  let currentPort = Number(basePort);
  let retries = Number(maxRetries);

  const tryListen = () => {
    const server = app.listen(currentPort, () => {
      const portInfo = currentPort === basePort ? `${currentPort}` : `${currentPort} (fallback)`;
      console.log(`[ui-web] running at http://localhost:${portInfo} | proxy -> ${BACKEND_URL}`);
    });

    server.on("error", (err) => {
      if (err?.code === "EADDRINUSE" && retries > 0) {
        console.warn(`[ui-web] port ${currentPort} in use, trying ${currentPort + 1}...`);
        currentPort += 1;
        retries -= 1;
        tryListen();
        return;
      }

      throw err;
    });
  };

  tryListen();
}

startServer(PORT);
