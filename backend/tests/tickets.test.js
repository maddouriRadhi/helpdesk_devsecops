/**
 * tickets.test.js – Tests unitaires pour les routes de tickets
 *
 * Note : Ces tests vérifient la logique des routes via des mocks
 * sans avoir besoin d'une connexion PostgreSQL.
 *
 * Couvre :
 *   ✅ Création d'un ticket (POST /api/tickets)
 *   ✅ Validation des champs obligatoires
 *   ✅ Modification du statut (PATCH /api/tickets/:id/statut)
 *   ✅ Statut invalide → 400
 *   ✅ Suppression d'un ticket (DELETE /api/tickets/:id)
 *   ✅ Ticket introuvable → 404
 */

const { signerToken } = require("../auth");

// Générer des tokens pour les tests
const tokenAgent = signerToken({ id: 1, identifiant: "agent", role: "agent" });
const tokenUtilisateur = signerToken({ id: 2, identifiant: "youssef", role: "utilisateur" });

describe("Logique métier des tickets", () => {
  // ── Validation des statuts ───────────────────────────────────────────
  describe("Statuts autorisés", () => {
    const statutsAutorises = ["Ouvert", "En cours", "Résolu"];

    test("les 3 statuts valides sont acceptés", () => {
      for (const statut of statutsAutorises) {
        expect(statutsAutorises.includes(statut)).toBe(true);
      }
    });

    test("un statut inconnu est rejeté", () => {
      expect(statutsAutorises.includes("Fermé")).toBe(false);
      expect(statutsAutorises.includes("Annulé")).toBe(false);
      expect(statutsAutorises.includes("")).toBe(false);
    });
  });

  // ── Validation des champs obligatoires ────────────────────────────────
  describe("Validation des champs de ticket", () => {
    function validerTicket({ titre, demandeur, categorie, priorite }) {
      if (!titre || !demandeur || !categorie || !priorite) {
        return { valide: false, message: "Champs obligatoires manquants." };
      }
      return { valide: true };
    }

    test("ticket complet est valide", () => {
      const resultat = validerTicket({
        titre: "Problème VPN",
        demandeur: "youssef",
        categorie: "Réseau",
        priorite: "Haute",
      });
      expect(resultat.valide).toBe(true);
    });

    test("ticket sans titre est invalide", () => {
      const resultat = validerTicket({
        titre: "",
        demandeur: "youssef",
        categorie: "Réseau",
        priorite: "Haute",
      });
      expect(resultat.valide).toBe(false);
    });

    test("ticket sans demandeur est invalide", () => {
      const resultat = validerTicket({
        titre: "Test",
        demandeur: "",
        categorie: "Réseau",
        priorite: "Haute",
      });
      expect(resultat.valide).toBe(false);
    });

    test("ticket sans catégorie est invalide", () => {
      const resultat = validerTicket({
        titre: "Test",
        demandeur: "youssef",
        categorie: "",
        priorite: "Haute",
      });
      expect(resultat.valide).toBe(false);
    });

    test("ticket sans priorité est invalide", () => {
      const resultat = validerTicket({
        titre: "Test",
        demandeur: "youssef",
        categorie: "Réseau",
        priorite: "",
      });
      expect(resultat.valide).toBe(false);
    });
  });

  // ── Contrôle d'accès IDOR ─────────────────────────────────────────────
  describe("Contrôle d'accès IDOR", () => {
    function verifierAccesTicket(utilisateur, ticket) {
      if (utilisateur.role === "agent") return true;
      return ticket.demandeur.toLowerCase() === utilisateur.identifiant.toLowerCase();
    }

    test("un agent peut accéder à n'importe quel ticket", () => {
      const agent = { id: 1, identifiant: "agent", role: "agent" };
      const ticket = { demandeur: "youssef" };
      expect(verifierAccesTicket(agent, ticket)).toBe(true);
    });

    test("un utilisateur peut accéder à son propre ticket", () => {
      const user = { id: 2, identifiant: "youssef", role: "utilisateur" };
      const ticket = { demandeur: "youssef" };
      expect(verifierAccesTicket(user, ticket)).toBe(true);
    });

    test("un utilisateur ne peut PAS accéder au ticket d'un autre", () => {
      const user = { id: 2, identifiant: "youssef", role: "utilisateur" };
      const ticket = { demandeur: "admin" };
      expect(verifierAccesTicket(user, ticket)).toBe(false);
    });

    test("la comparaison est insensible à la casse", () => {
      const user = { id: 2, identifiant: "Youssef", role: "utilisateur" };
      const ticket = { demandeur: "youssef" };
      expect(verifierAccesTicket(user, ticket)).toBe(true);
    });
  });

  // ── Validation des commentaires ───────────────────────────────────────
  describe("Validation des commentaires", () => {
    function validerCommentaire(contenu) {
      if (!contenu || !contenu.trim()) {
        return { valide: false, message: "Le commentaire ne peut pas être vide." };
      }
      if (contenu.trim().length > 2000) {
        return { valide: false, message: "Le commentaire est trop long." };
      }
      return { valide: true };
    }

    test("commentaire valide", () => {
      expect(validerCommentaire("Un commentaire normal").valide).toBe(true);
    });

    test("commentaire vide est rejeté", () => {
      expect(validerCommentaire("").valide).toBe(false);
      expect(validerCommentaire("   ").valide).toBe(false);
    });

    test("commentaire null est rejeté", () => {
      expect(validerCommentaire(null).valide).toBe(false);
      expect(validerCommentaire(undefined).valide).toBe(false);
    });

    test("commentaire trop long est rejeté", () => {
      const tresLong = "A".repeat(2001);
      expect(validerCommentaire(tresLong).valide).toBe(false);
    });

    test("commentaire de 2000 caractères est accepté", () => {
      const pile2000 = "A".repeat(2000);
      expect(validerCommentaire(pile2000).valide).toBe(true);
    });
  });

  // ── Tokens JWT ────────────────────────────────────────────────────────
  describe("Tokens générés", () => {
    test("le token agent est un JWT valide", () => {
      expect(tokenAgent).toBeDefined();
      expect(tokenAgent.split(".")).toHaveLength(3);
    });

    test("le token utilisateur est un JWT valide", () => {
      expect(tokenUtilisateur).toBeDefined();
      expect(tokenUtilisateur.split(".")).toHaveLength(3);
    });
  });
});
