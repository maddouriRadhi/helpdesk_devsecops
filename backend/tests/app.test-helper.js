/**
 * app.test.js – Helper : crée une instance Express testable
 * sans démarrer le serveur TCP (pour les tests Jest + Supertest).
 *
 * On exporte une fonction qui retourne l'app Express configurée
 * mais sans appeler app.listen().
 */

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const pool = require("../db");
const { signerToken, verifierToken, exigerRole } = require("../auth");

function creerApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  // ── Health ───────────────────────────────────────────────────────
  app.get("/api/health", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok" });
    } catch {
      res.status(500).json({ status: "error" });
    }
  });

  // ── Auth ─────────────────────────────────────────────────────────
  app.post("/api/auth/login", async (req, res) => {
    const { identifiant, motDePasse } = req.body;
    if (!identifiant || !motDePasse)
      return res.status(400).json({ message: "Identifiant et mot de passe requis." });

    const r = await pool.query(
      "SELECT id, identifiant, mot_de_passe, role FROM utilisateurs WHERE identifiant = $1",
      [identifiant.trim()]
    );
    if (r.rowCount === 0 || !await bcrypt.compare(motDePasse, r.rows[0].mot_de_passe))
      return res.status(401).json({ message: "Identifiant ou mot de passe incorrect." });

    const utilisateur = r.rows[0];
    const token = signerToken({ id: utilisateur.id, identifiant: utilisateur.identifiant, role: utilisateur.role });
    res.json({ token, utilisateur: { id: utilisateur.id, identifiant: utilisateur.identifiant, role: utilisateur.role } });
  });

  app.post("/api/auth/logout", verifierToken, (req, res) => {
    res.json({ message: "Déconnexion réussie." });
  });

  // ── Tickets ──────────────────────────────────────────────────────
  app.get("/api/tickets", verifierToken, async (req, res) => {
    const { q } = req.query;
    const { identifiant, role } = req.utilisateur;
    let query, params;
    if (role === "agent") {
      if (q) { query = `SELECT * FROM tickets WHERE titre ILIKE $1 OR id ILIKE $1 OR demandeur ILIKE $1 ORDER BY created_at DESC`; params = [`%${q}%`]; }
      else { query = `SELECT * FROM tickets ORDER BY created_at DESC`; params = []; }
    } else {
      if (q) { query = `SELECT * FROM tickets WHERE demandeur ILIKE $1 AND (titre ILIKE $2 OR id ILIKE $2) ORDER BY created_at DESC`; params = [identifiant, `%${q}%`]; }
      else { query = `SELECT * FROM tickets WHERE demandeur ILIKE $1 ORDER BY created_at DESC`; params = [identifiant]; }
    }
    const r = await pool.query(query, params);
    res.json(r.rows);
  });

  app.get("/api/tickets/:id", verifierToken, async (req, res) => {
    const r = await pool.query("SELECT * FROM tickets WHERE id = $1", [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ message: "Ticket introuvable." });
    const ticket = r.rows[0];
    if (req.utilisateur.role === "utilisateur" && ticket.demandeur.toLowerCase() !== req.utilisateur.identifiant.toLowerCase())
      return res.status(403).json({ message: "Accès refusé à ce ticket." });
    res.json(ticket);
  });

  app.post("/api/tickets", verifierToken, async (req, res) => {
    const { titre, demandeur, categorie, priorite, statut } = req.body;
    if (!titre || !demandeur || !categorie || !priorite)
      return res.status(400).json({ message: "Champs obligatoires manquants." });
    const r = await pool.query(
      `INSERT INTO tickets (titre,demandeur,categorie,priorite,statut) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [titre, demandeur, categorie, priorite, statut || "Ouvert"]
    );
    res.status(201).json(r.rows[0]);
  });

  app.patch("/api/tickets/:id/statut", verifierToken, exigerRole("agent"), async (req, res) => {
    const { statut } = req.body;
    if (!["Ouvert", "En cours", "Résolu"].includes(statut))
      return res.status(400).json({ message: "Statut invalide." });
    const r = await pool.query(`UPDATE tickets SET statut=$1 WHERE id=$2 RETURNING *`, [statut, req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ message: "Ticket introuvable." });
    res.json(r.rows[0]);
  });

  app.delete("/api/tickets/:id", verifierToken, exigerRole("agent"), async (req, res) => {
    const r = await pool.query("DELETE FROM tickets WHERE id=$1 RETURNING id", [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ message: "Ticket introuvable." });
    res.json({ message: "Ticket supprimé.", id: r.rows[0].id });
  });

  // ── Commentaires ─────────────────────────────────────────────────
  app.get("/api/tickets/:id/comments", verifierToken, async (req, res) => {
    const ticket = await pool.query("SELECT demandeur FROM tickets WHERE id=$1", [req.params.id]);
    if (ticket.rowCount === 0) return res.status(404).json({ message: "Ticket introuvable." });
    if (req.utilisateur.role === "utilisateur" && ticket.rows[0].demandeur.toLowerCase() !== req.utilisateur.identifiant.toLowerCase())
      return res.status(403).json({ message: "Accès refusé." });
    const r = await pool.query("SELECT * FROM commentaires WHERE ticket_id=$1 ORDER BY created_at ASC", [req.params.id]);
    res.json(r.rows);
  });

  app.post("/api/tickets/:id/comments", verifierToken, async (req, res) => {
    const { contenu } = req.body;
    if (!contenu || !contenu.trim()) return res.status(400).json({ message: "Commentaire vide." });
    if (contenu.trim().length > 2000) return res.status(400).json({ message: "Trop long." });
    const ticket = await pool.query("SELECT demandeur FROM tickets WHERE id=$1", [req.params.id]);
    if (ticket.rowCount === 0) return res.status(404).json({ message: "Ticket introuvable." });
    if (req.utilisateur.role === "utilisateur" && ticket.rows[0].demandeur.toLowerCase() !== req.utilisateur.identifiant.toLowerCase())
      return res.status(403).json({ message: "Accès refusé." });
    const r = await pool.query(
      `INSERT INTO commentaires (ticket_id,auteur,contenu) VALUES ($1,$2,$3) RETURNING *`,
      [req.params.id, req.utilisateur.identifiant, contenu.trim()]
    );
    res.status(201).json(r.rows[0]);
  });

  return app;
}

module.exports = creerApp;
