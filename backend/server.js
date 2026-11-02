const express = require("express");
const cors = require("cors");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

async function initialiserBaseDeDonnees() {
  await pool.query(`
    CREATE SEQUENCE IF NOT EXISTS ticket_number_seq
    START WITH 1043;
  `);

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

  // Ajoute deux exemples si la table est encore vide
  await pool.query(`
    INSERT INTO tickets (id, titre, demandeur, categorie, priorite, statut)
    VALUES
      ('HD-1042', 'Problème de connexion au compte', 'admin', 'Compte', 'Haute', 'Ouvert'),
      ('HD-1041', 'Installation de Microsoft Teams', 'Youssef Trabelsi', 'Logiciel', 'Normale', 'En cours')
    ON CONFLICT (id) DO NOTHING;
  `);
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", message: "Backend et base de données fonctionnent." });
  } catch (error) {
    console.error("Erreur PostgreSQL :", error.message);
    res.status(500).json({ status: "error", message: "Connexion à la base impossible." });
  }
});

app.get("/api/tickets", async (req, res) => {
  try {
    const resultat = await pool.query(`
      SELECT id, titre, demandeur, categorie, priorite, statut
      FROM tickets
      ORDER BY created_at DESC
    `);

    res.json(resultat.rows);
  } catch (error) {
    console.error("Erreur lecture tickets :", error.message);
    res.status(500).json({ message: "Impossible de récupérer les tickets." });
  }
});

app.post("/api/tickets", async (req, res) => {
  const { titre, demandeur, categorie, priorite, statut } = req.body;

  if (!titre || !demandeur || !categorie || !priorite) {
    return res.status(400).json({
      message: "Les champs titre, demandeur, catégorie et priorité sont obligatoires.",
    });
  }

  try {
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
app.patch("/api/tickets/:id/statut", async (req, res) => {
  const { statut } = req.body;
  const statutsAutorises = ["Ouvert", "En cours", "Résolu"];

  if (!statutsAutorises.includes(statut)) {
    return res.status(400).json({
      message: "Statut invalide. Choisis Ouvert, En cours ou Résolu.",
    });
  }

  try {
    const resultat = await pool.query(
      `UPDATE tickets
       SET statut = $1
       WHERE id = $2
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
app.delete("/api/tickets/:id", async (req, res) => {
  try {
    const resultat = await pool.query(
      `DELETE FROM tickets
       WHERE id = $1
       RETURNING id`,
      [req.params.id]
    );

    if (resultat.rowCount === 0) {
      return res.status(404).json({ message: "Ticket introuvable." });
    }

    res.json({
      message: "Ticket supprimé.",
      id: resultat.rows[0].id,
    });
  } catch (error) {
    console.error("Erreur suppression ticket :", error.message);
    res.status(500).json({ message: "Impossible de supprimer le ticket." });
  }
});

async function demarrerServeur() {
  try {
    await initialiserBaseDeDonnees();
    app.listen(PORT, () => {
      console.log(`Backend HelpDesk démarré sur http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Échec de démarrage :", error.message);
    process.exit(1);
  }
}

demarrerServeur();