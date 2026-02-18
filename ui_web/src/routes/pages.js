const express = require("express");

const router = express.Router();

router.get("/", (req, res) => {
  res.render("pages/dashboard", {
    title: "Visao geral",
    pageScript: "/public/js/dashboard.js",
  });
});

router.get("/create-lead-demos", (req, res) => {
  res.render("pages/create-lead-demos", {
    title: "Criar lead (demos)",
    pageScript: "/public/js/create-lead-demos.js",
  });
});

router.get("/leads", (req, res) => {
  res.render("pages/leads", { title: "Leads", pageScript: "/public/js/leads.js" });
});

router.get("/kanban", (req, res) => {
  res.render("pages/kanban", {
    title: "CRM (Kanban)",
    pageScript: "/public/js/kanban.js",
  });
});

router.get("/partners", (req, res) => {
  res.render("pages/partners", { title: "Parceiros", pageScript: "/public/js/partners.js" });
});

router.get("/settings", (req, res) => {
  res.render("pages/settings", {
    title: "Configuracoes",
    pageScript: "/public/js/settings.js",
  });
});

module.exports = router;
