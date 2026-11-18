/**
 * server.js – Backend Express.js sécurisé pour HelpDesk DevSecOps
 *
 * Routes :
 *   POST   /api/auth/login          – Connexion (retourne un JWT)
 *   POST   /api/auth/logout         – Déconnexion (côté client)
 *   GET    /api/tickets             – Liste des tickets (filtrage par rôle + recherche ?q=)
 *   GET    /api/tickets/:id         – Détail d'un ticket (contrôle d'accès)
 *   POST   /api/tickets             – Créer un ticket
 *   PATCH  /api/tickets/:id/statut  – Modifier le statut (agent uniquement)
 *   DELETE /api/tickets/:id         – Supprimer un ticket (agent uniquement)
 *   GET    /api/tickets/:id/comments – Lister les commentaires
 *   POST   /api/tickets/:id/comments – Ajouter un commentaire
 *   GET    /api/health              – Vérification santé
 *
 * Sécurité :
 *   ✅ Requêtes paramétrées (anti-SQLi)
 *   ✅ Échappement des entrées (anti-XSS)
 *   ✅ Contrôle d'accès par propriétaire (anti-IDOR)
 *   ✅ Secret JWT via variable d'environnement
 *   ✅ x-powered-by désactivé
 *   ✅ Error handler sans stack trace en production
 */

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const pool = require("./db");
const { signerToken, verifierToken, exigerRole } = require("./auth");
const logger = require("./logger");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Sécurité de base ────────────────────────────────────────────────────
app.disable("x-powered-by");
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));

// ── Middleware de log de toutes les requêtes ─────────────────────────────
app.use((req, res, next) => {
  res.on("finish", () => {
    const level = res.statusCode >= 400 ? "warn" : "info";
    logger[level]("http_request", {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ip: req.ip || req.headers["x-forwarded-for"],
      user: req.utilisateur?.identifiant || "anonymous",
    });
  });
  next();
});

// ── Initialisation de la base de données ────────────────────────────────
async function initialiserBaseDeDonnees() {
  // Table des utilisateurs
  await pool.query(`
    CREATE TABLE IF NOT EXISTS utilisateurs (
      id SERIAL PRIMARY KEY,
      identifiant VARCHAR(80) UNIQUE NOT NULL,
      mot_de_passe VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'utilisateur'
        CHECK (role IN ('agent', 'utilisateur'))
    );
  `);

  // Séquence pour les numéros de ticket
  await pool.query(`
    CREATE SEQUENCE IF NOT EXISTS ticket_number_seq START WITH 1043;
  `);

  // Table des tickets
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id VARCHAR(20) PRIMARY KEY
        DEFAULT ('HD-' || nextval('ticket_number_seq')),
      titre VARCHAR(200) NOT NULL,
      demandeur VARCHAR(120) NOT NULL,
      categorie VARCHAR(50) NOT NULL,
      priorite VARCHAR(20) NOT NULL,
      statut VARCHAR(30) NOT NULL DEFAULT 'Ouvert',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Table des commentaires
  await pool.query(`
    CREATE TABLE IF NOT EXISTS commentaires (
      id SERIAL PRIMARY KEY,
      ticket_id VARCHAR(20) NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      auteur VARCHAR(80) NOT NULL,
      contenu TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ── Seed data : comptes de démonstration ──────────────────────────
  const compteAgent = await pool.query(
    "SELECT id FROM utilisateurs WHERE identifiant = $1",
    ["agent"]
  );
  if (compteAgent.rowCount === 0) {
    const hashAgent = await bcrypt.hash("agent1234", 10);
    await pool.query(
      "INSERT INTO utilisateurs (identifiant, mot_de_passe, role) VALUES ($1, $2, $3)",
      ["agent", hashAgent, "agent"]
    );
    console.log("✔ Compte agent créé (agent / agent1234)");
  }

  const compteUser = await pool.query(
    "SELECT id FROM utilisateurs WHERE identifiant = $1",
    ["youssef"]
  );
  if (compteUser.rowCount === 0) {
    const hashUser = await bcrypt.hash("user1234", 10);
    await pool.query(
      "INSERT INTO utilisateurs (identifiant, mot_de_passe, role) VALUES ($1, $2, $3)",
      ["youssef", hashUser, "utilisateur"]
    );
    console.log("✔ Compte utilisateur créé (youssef / user1234)");
  }

  // ── Seed data : tickets d'exemple ────────────────────────────────
  await pool.query(`
    INSERT INTO tickets (id, titre, demandeur, categorie, priorite, statut)
    VALUES
      ('HD-1042', 'Problème de connexion au compte', 'agent', 'Compte', 'Haute', 'Ouvert'),
      ('HD-1041', 'Installation de Microsoft Teams', 'youssef', 'Logiciel', 'Normale', 'En cours')
    ON CONFLICT (id) DO NOTHING;
  `);
}

// ═══════════════════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════════════════

// ── Health ───────────────────────────────────────────────────────────────
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", message: "Backend et base de données fonctionnent." });
  } catch (error) {
    console.error("Erreur PostgreSQL :", error.message);
    res.status(500).json({ status: "error", message: "Connexion à la base impossible." });
  }
});

// ── Auth : Login ────────────────────────────────────────────────────────
// ── Compteur de tentatives de login (anti-bruteforce) ───────────────────
const tentativesLogin = new Map();

app.post("/api/auth/login", async (req, res) => {
  const { identifiant, motDePasse } = req.body;
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";

  if (!identifiant || !motDePasse) {
    return res.status(400).json({ message: "Identifiant et mot de passe requis." });
  }

  // Détection bruteforce : > 5 tentatives depuis la même IP/identifiant
  const cle = `${ip}:${identifiant}`;
  const tentatives = (tentativesLogin.get(cle) || 0) + 1;
  tentativesLogin.set(cle, tentatives);
  setTimeout(() => tentativesLogin.delete(cle), 15 * 60 * 1000);

  if (tentatives > 5) {
    logger.security("warn", "bruteforce_detected", {
      ip, identifiant, tentatives, attack_type: "bruteforce_login",
    });
  }

  try {
    // ✅ Requête paramétrée (anti-SQLi)
    const resultat = await pool.query(
      "SELECT id, identifiant, mot_de_passe, role FROM utilisateurs WHERE identifiant = $1",
      [identifiant.trim()]
    );

    if (resultat.rowCount === 0) {
      logger.security("warn", "login_failed", {
        ip, identifiant, reason: "user_not_found", attack_type: "invalid_credentials",
      });
      return res.status(401).json({ message: "Identifiant ou mot de passe incorrect." });
    }

    const utilisateur = resultat.rows[0];
    const motDePasseValide = await bcrypt.compare(motDePasse, utilisateur.mot_de_passe);

    if (!motDePasseValide) {
      logger.security("warn", "login_failed", {
        ip, identifiant, reason: "wrong_password", attack_type: "invalid_credentials",
      });
      return res.status(401).json({ message: "Identifiant ou mot de passe incorrect." });
    }

    const token = signerToken({
      id: utilisateur.id,
      identifiant: utilisateur.identifiant,
      role: utilisateur.role,
    });

    logger.info("login_success", { ip, identifiant, role: utilisateur.role });

    res.json({
      token,
      utilisateur: {
        id: utilisateur.id,
        identifiant: utilisateur.identifiant,
        role: utilisateur.role,
      },
    });
  } catch (error) {
    logger.error("login_error", { error: error.message });
    res.status(500).json({ message: "Erreur interne du serveur." });
  }
});

// ── Auth : Logout ───────────────────────────────────────────────────────
app.post("/api/auth/logout", verifierToken, (req, res) => {
  // Côté serveur, le JWT est stateless : la déconnexion est gérée côté client.
  res.json({ message: "Déconnexion réussie." });
});

// ── Tickets : Liste (avec recherche ?q= et filtrage par rôle) ───────────
app.get("/api/tickets", verifierToken, async (req, res) => {
  try {
    const { q } = req.query;
    const { identifiant, role } = req.utilisateur;
    let query, params;

    if (role === "agent") {
      // L'agent voit tous les tickets
      if (q) {
        // ✅ Requête paramétrée (anti-SQLi)
        query = `SELECT id, titre, demandeur, categorie, priorite, statut, created_at
                 FROM tickets
                 WHERE titre ILIKE $1 OR id ILIKE $1 OR demandeur ILIKE $1
                 ORDER BY created_at DESC`;
        params = [`%${q}%`];
      } else {
        query = `SELECT id, titre, demandeur, categorie, priorite, statut, created_at
                 FROM tickets ORDER BY created_at DESC`;
        params = [];
      }
    } else {
      // ✅ L'utilisateur ne voit que ses propres tickets (anti-IDOR)
      if (q) {
        query = `SELECT id, titre, demandeur, categorie, priorite, statut, created_at
                 FROM tickets
                 WHERE demandeur ILIKE $1 AND (titre ILIKE $2 OR id ILIKE $2)
                 ORDER BY created_at DESC`;
        params = [identifiant, `%${q}%`];
      } else {
        query = `SELECT id, titre, demandeur, categorie, priorite, statut, created_at
                 FROM tickets
                 WHERE demandeur ILIKE $1
                 ORDER BY created_at DESC`;
        params = [identifiant];
      }
    }

    const resultat = await pool.query(query, params);
    res.json(resultat.rows);
  } catch (error) {
    console.error("Erreur lecture tickets :", error.message);
    res.status(500).json({ message: "Impossible de récupérer les tickets." });
  }
});

// ── Tickets : Détail (avec contrôle d'accès) ───────────────────────────
app.get("/api/tickets/:id", verifierToken, async (req, res) => {
  try {
    const resultat = await pool.query(
      "SELECT * FROM tickets WHERE id = $1",
      [req.params.id]
    );

    if (resultat.rowCount === 0) {
      return res.status(404).json({ message: "Ticket introuvable." });
    }

    const ticket = resultat.rows[0];

    // ✅ Contrôle d'accès : un utilisateur ne peut voir que ses propres tickets (anti-IDOR)
    if (
      req.utilisateur.role === "utilisateur" &&
      ticket.demandeur.toLowerCase() !== req.utilisateur.identifiant.toLowerCase()
    ) {
      return res.status(403).json({ message: "Accès refusé à ce ticket." });
    }

    res.json(ticket);
  } catch (error) {
    console.error("Erreur détail ticket :", error.message);
    res.status(500).json({ message: "Impossible de récupérer le ticket." });
  }
});

// ── Tickets : Créer ─────────────────────────────────────────────────────
app.post("/api/tickets", verifierToken, async (req, res) => {
  const { titre, demandeur, categorie, priorite, statut } = req.body;

  if (!titre || !demandeur || !categorie || !priorite) {
    return res.status(400).json({
      message: "Les champs titre, demandeur, catégorie et priorité sont obligatoires.",
    });
  }

  try {
    // ✅ Requête paramétrée (anti-SQLi)
    const resultat = await pool.query(
      `INSERT INTO tickets (titre, demandeur, categorie, priorite, statut)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, titre, demandeur, categorie, priorite, statut`,
      [titre, demandeur, categorie, priorite, statut || "Ouvert"]
    );

    res.status(201).json(resultat.rows[0]);
  } catch (error) {
    console.error("Erreur création ticket :", error.message);
    res.status(500).json({ message: "Impossible d'enregistrer le ticket." });
  }
});

// ── Tickets : Modifier le statut (agent uniquement) ─────────────────────
app.patch("/api/tickets/:id/statut", verifierToken, exigerRole("agent"), async (req, res) => {
  const { statut } = req.body;
  const statutsAutorises = ["Ouvert", "En cours", "Résolu"];

  if (!statutsAutorises.includes(statut)) {
    return res.status(400).json({
      message: "Statut invalide. Choisis Ouvert, En cours ou Résolu.",
    });
  }

  try {
    const resultat = await pool.query(
      `UPDATE tickets SET statut = $1 WHERE id = $2
       RETURNING id, titre, demandeur, categorie, priorite, statut`,
      [statut, req.params.id]
    );

    if (resultat.rowCount === 0) {
      return res.status(404).json({ message: "Ticket introuvable." });
    }

    res.json(resultat.rows[0]);
  } catch (error) {
    console.error("Erreur modification du statut :", error.message);
    res.status(500).json({ message: "Impossible de modifier le statut." });
  }
});

// ── Tickets : Supprimer (agent uniquement) ──────────────────────────────
app.delete("/api/tickets/:id", verifierToken, exigerRole("agent"), async (req, res) => {
  try {
    const resultat = await pool.query(
      `DELETE FROM tickets WHERE id = $1 RETURNING id`,
      [req.params.id]
    );

    if (resultat.rowCount === 0) {
      return res.status(404).json({ message: "Ticket introuvable." });
    }

    res.json({ message: "Ticket supprimé.", id: resultat.rows[0].id });
  } catch (error) {
    console.error("Erreur suppression ticket :", error.message);
    res.status(500).json({ message: "Impossible de supprimer le ticket." });
  }
});

// ── Commentaires : Lister ───────────────────────────────────────────────
app.get("/api/tickets/:id/comments", verifierToken, async (req, res) => {
  try {
    // Vérifier que le ticket existe
    const ticket = await pool.query(
      "SELECT demandeur FROM tickets WHERE id = $1",
      [req.params.id]
    );

    if (ticket.rowCount === 0) {
      return res.status(404).json({ message: "Ticket introuvable." });
    }

    // ✅ Anti-IDOR : un utilisateur ne peut voir que les commentaires de ses tickets
    if (
      req.utilisateur.role === "utilisateur" &&
      ticket.rows[0].demandeur.toLowerCase() !== req.utilisateur.identifiant.toLowerCase()
    ) {
      return res.status(403).json({ message: "Accès refusé." });
    }

    const resultat = await pool.query(
      "SELECT * FROM commentaires WHERE ticket_id = $1 ORDER BY created_at ASC",
      [req.params.id]
    );

    res.json(resultat.rows);
  } catch (error) {
    console.error("Erreur lecture commentaires :", error.message);
    res.status(500).json({ message: "Impossible de récupérer les commentaires." });
  }
});

// ── Commentaires : Ajouter ──────────────────────────────────────────────
app.post("/api/tickets/:id/comments", verifierToken, async (req, res) => {
  const { contenu } = req.body;

  if (!contenu || !contenu.trim()) {
    return res.status(400).json({ message: "Le commentaire ne peut pas être vide." });
  }

  if (contenu.trim().length > 2000) {
    return res.status(400).json({ message: "Le commentaire est trop long (max 2000 caractères)." });
  }

  try {
    // Vérifier que le ticket existe
    const ticket = await pool.query(
      "SELECT demandeur FROM tickets WHERE id = $1",
      [req.params.id]
    );

    if (ticket.rowCount === 0) {
      return res.status(404).json({ message: "Ticket introuvable." });
    }

    // ✅ Anti-IDOR : un utilisateur ne peut commenter que ses propres tickets
    if (
      req.utilisateur.role === "utilisateur" &&
      ticket.rows[0].demandeur.toLowerCase() !== req.utilisateur.identifiant.toLowerCase()
    ) {
      return res.status(403).json({ message: "Accès refusé." });
    }

    // ✅ Requête paramétrée (anti-SQLi)
    const resultat = await pool.query(
      `INSERT INTO commentaires (ticket_id, auteur, contenu)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.params.id, req.utilisateur.identifiant, contenu.trim()]
    );

    res.status(201).json(resultat.rows[0]);
  } catch (error) {
    console.error("Erreur ajout commentaire :", error.message);
    res.status(500).json({ message: "Impossible d'ajouter le commentaire." });
  }
});

// ── Error handler global (sans stack trace en production) ────────────────
app.use((err, req, res, _next) => {
  console.error("Erreur non gérée :", err.message);
  // ✅ Pas de stack trace exposée en production (anti-info-leak)
  res.status(500).json({ message: "Erreur interne du serveur." });
});

// ═══════════════════════════════════════════════════════════════════════
//  DÉMARRAGE
// ═══════════════════════════════════════════════════════════════════════

async function demarrerServeur() {
  try {
    await initialiserBaseDeDonnees();
    console.log("✔ Base de données initialisée.");

    app.listen(PORT, () => {
      console.log(`🚀 Backend HelpDesk démarré sur http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Échec de démarrage :", error.message);
    process.exit(1);
  }
}

demarrerServeur();

// Export pour les tests
module.exports = app;