/**
 * security.test.js – Tests de sécurité pour le backend HelpDesk
 *
 * Vérifie que les protections suivantes sont actives dans server.js :
 *   ✅ x-powered-by est désactivé
 *   ✅ Les requêtes SQL sont paramétrées (anti-SQLi)
 *   ✅ Le secret JWT provient d'une variable d'environnement
 *   ✅ Les erreurs ne divulguent pas de stack trace
 *   ✅ Le contrôle d'accès IDOR est en place
 */

const fs = require("fs");
const path = require("path");

// Lire le code source pour vérification statique
const serverCode = fs.readFileSync(
  path.join(__dirname, "..", "server.js"),
  "utf-8"
);
const authCode = fs.readFileSync(
  path.join(__dirname, "..", "auth.js"),
  "utf-8"
);
const vulnerableCode = fs.readFileSync(
  path.join(__dirname, "..", "server.vulnerable.js"),
  "utf-8"
);

// ── Tests sur server.js (version sécurisée) ────────────────────────────
describe("server.js – Vérifications de sécurité", () => {
  test("x-powered-by est désactivé", () => {
    expect(serverCode).toContain('app.disable("x-powered-by")');
  });

  test("pas de concaténation SQL directe", () => {
    // On vérifie qu'il n'y a pas de template literal dans une requête SQL
    // avec des variables non-paramétrées (pattern : '${variable}')
    const lignes = serverCode.split("\n");
    const lignesSQL = lignes.filter(
      (l) => l.includes("pool.query") || l.includes("SELECT") || l.includes("INSERT") || l.includes("UPDATE") || l.includes("DELETE")
    );

    for (const ligne of lignesSQL) {
      // Exclure les commentaires
      if (ligne.trim().startsWith("//") || ligne.trim().startsWith("*")) continue;
      // Vérifier qu'il n'y a pas de ${...} dans une requête SQL non-commentée
      if (ligne.includes("ILIKE") || ligne.includes("WHERE")) {
        // Les seules interpolations autorisées sont les $ paramètres PostgreSQL ($1, $2, etc.)
        const match = ligne.match(/\$\{[^}]+\}/);
        if (match) {
          // Vérifier que c'est dans un commentaire
          const indexComment = ligne.indexOf("//");
          const indexMatch = ligne.indexOf(match[0]);
          if (indexComment === -1 || indexMatch < indexComment) {
            // S'assurer que ce n'est pas le HD- format qui utilise nextval
            if (!match[0].includes("nextval")) {
              fail(`Concaténation SQL dangereuse trouvée : ${match[0]} dans : ${ligne.trim()}`);
            }
          }
        }
      }
    }
  });

  test("le secret JWT n'est pas codé en dur dans server.js", () => {
    // Vérifier qu'il n'y a pas de secret JWT en dur
    expect(serverCode).not.toMatch(/JWT_SECRET\s*=\s*["'][^"']*secret[^"']*["']/i);
    expect(serverCode).not.toMatch(/JWT_SECRET\s*=\s*["']super-secret/i);
  });

  test("le secret JWT utilise process.env dans auth.js", () => {
    expect(authCode).toContain("process.env.JWT_SECRET");
  });

  test("les erreurs ne divulguent pas la stack trace", () => {
    // Le handler d'erreur global ne doit pas inclure err.stack
    const errorHandlerMatch = serverCode.match(
      /app\.use\(\(err,\s*req,\s*res[\s\S]*?\n\}\);/
    );
    if (errorHandlerMatch) {
      expect(errorHandlerMatch[0]).not.toContain("err.stack");
      expect(errorHandlerMatch[0]).not.toContain("error.stack");
    }
  });

  test("les routes de tickets utilisent verifierToken", () => {
    // Toutes les routes /api/tickets doivent utiliser verifierToken
    const routePatterns = [
      /app\.get\("\/api\/tickets"/,
      /app\.get\("\/api\/tickets\/:id"/,
      /app\.post\("\/api\/tickets"/,
      /app\.patch\("\/api\/tickets/,
      /app\.delete\("\/api\/tickets/,
    ];

    for (const pattern of routePatterns) {
      const match = serverCode.match(pattern);
      if (match) {
        // Vérifier que la ligne contient aussi verifierToken
        const lineIndex = serverCode.indexOf(match[0]);
        const lineEnd = serverCode.indexOf("\n", lineIndex);
        const line = serverCode.substring(lineIndex, lineEnd);
        expect(line).toContain("verifierToken");
      }
    }
  });

  test("PATCH et DELETE exigent le rôle agent", () => {
    const patchLine = serverCode.match(/app\.patch.*statut.*/);
    const deleteLine = serverCode.match(/app\.delete.*tickets.*/);

    if (patchLine) {
      expect(patchLine[0]).toContain('exigerRole("agent")');
    }
    if (deleteLine) {
      expect(deleteLine[0]).toContain('exigerRole("agent")');
    }
  });

  test("le contrôle IDOR est présent pour les tickets", () => {
    // Vérifier que GET /api/tickets/:id vérifie le propriétaire
    expect(serverCode).toContain("demandeur.toLowerCase()");
    expect(serverCode).toContain("req.utilisateur.identifiant.toLowerCase()");
  });
});

// ── Tests sur server.vulnerable.js (vérifier que les failles existent) ─
describe("server.vulnerable.js – Failles intentionnelles", () => {
  test("FAILLE 1 : contient une concaténation SQL directe", () => {
    // La version vulnérable doit contenir une interpolation dans une requête SQL
    expect(vulnerableCode).toMatch(/ILIKE '%\$\{q\}%'/);
  });

  test("FAILLE 2 : contient un rendu HTML sans échappement", () => {
    expect(vulnerableCode).toContain("${c.contenu}");
    expect(vulnerableCode).toContain("text/html");
  });

  test("FAILLE 3 : ne vérifie pas le propriétaire du ticket", () => {
    // La version vulnérable ne doit PAS contenir de vérification IDOR
    // dans la route GET /api/tickets/:id
    const getTicketSection = vulnerableCode.match(
      /app\.get\("\/api\/tickets\/:id"[\s\S]*?(?=app\.(get|post|patch|delete|use))/
    );
    if (getTicketSection) {
      expect(getTicketSection[0]).not.toContain("demandeur.toLowerCase()");
    }
  });

  test("FAILLE 4a : x-powered-by n'est pas désactivé", () => {
    // Vérifier que app.disable("x-powered-by") est commenté
    const lines = vulnerableCode.split("\n");
    const disableLine = lines.find((l) => l.includes('app.disable("x-powered-by")'));
    if (disableLine) {
      expect(disableLine.trim().startsWith("//")).toBe(true);
    }
  });

  test("FAILLE 4b : secret JWT codé en dur", () => {
    expect(vulnerableCode).toMatch(/JWT_SECRET\s*=\s*["']super-secret/);
  });

  test("FAILLE 4d : stack trace exposée dans les réponses", () => {
    // Compter le nombre de fois que err.stack ou error.stack apparaît
    const stackLeaks = (vulnerableCode.match(/\.stack/g) || []).length;
    expect(stackLeaks).toBeGreaterThanOrEqual(3);
  });
});
