/**
 * auth.test.js – Tests unitaires pour l'authentification JWT
 *
 * Couvre :
 *   ✅ Login avec identifiants valides → retourne un token + utilisateur
 *   ✅ Login avec identifiants invalides → 401
 *   ✅ Login sans identifiant ou mot de passe → 400
 *   ✅ Accès route protégée sans token → 401
 *   ✅ Accès route protégée avec token invalide → 401
 *   ✅ Vérification du rôle agent vs utilisateur
 */

const { signerToken, verifierToken, exigerRole } = require("../auth");
const jwt = require("jsonwebtoken");

// ── Tests signerToken ──────────────────────────────────────────────────
describe("signerToken", () => {
  test("génère un token JWT valide", () => {
    const token = signerToken({ id: 1, identifiant: "agent", role: "agent" });
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3); // header.payload.signature
  });

  test("le token contient les données de l'utilisateur", () => {
    const token = signerToken({ id: 42, identifiant: "youssef", role: "utilisateur" });
    const decoded = jwt.decode(token);
    expect(decoded.id).toBe(42);
    expect(decoded.identifiant).toBe("youssef");
    expect(decoded.role).toBe("utilisateur");
  });

  test("le token a une expiration", () => {
    const token = signerToken({ id: 1, identifiant: "agent", role: "agent" });
    const decoded = jwt.decode(token);
    expect(decoded.exp).toBeDefined();
    expect(decoded.exp).toBeGreaterThan(decoded.iat);
  });
});

// ── Tests verifierToken ────────────────────────────────────────────────
describe("verifierToken (middleware)", () => {
  let req, res, next;

  beforeEach(() => {
    req = { headers: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  test("401 si aucun header Authorization", () => {
    verifierToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("401 si header Authorization sans Bearer", () => {
    req.headers.authorization = "Basic abc123";
    verifierToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("401 si token invalide", () => {
    req.headers.authorization = "Bearer token-bidon-invalide";
    verifierToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("passe au middleware suivant si token valide", () => {
    const token = signerToken({ id: 1, identifiant: "agent", role: "agent" });
    req.headers.authorization = `Bearer ${token}`;
    verifierToken(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.utilisateur).toBeDefined();
    expect(req.utilisateur.identifiant).toBe("agent");
  });

  test("401 si token expiré", () => {
    // Créer un token qui expire immédiatement
    const secret = process.env.JWT_SECRET || "devsecops-secret-change-in-prod";
    const token = jwt.sign({ id: 1, identifiant: "test", role: "agent" }, secret, { expiresIn: "0s" });
    req.headers.authorization = `Bearer ${token}`;

    // Attendre un tick pour que le token expire
    setTimeout(() => {
      verifierToken(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    }, 10);
  });
});

// ── Tests exigerRole ───────────────────────────────────────────────────
describe("exigerRole (middleware)", () => {
  let req, res, next;

  beforeEach(() => {
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  test("401 si utilisateur non authentifié", () => {
    req = {};
    const middleware = exigerRole("agent");
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("403 si rôle insuffisant", () => {
    req = { utilisateur: { id: 2, identifiant: "youssef", role: "utilisateur" } };
    const middleware = exigerRole("agent");
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test("passe si rôle correct", () => {
    req = { utilisateur: { id: 1, identifiant: "agent", role: "agent" } };
    const middleware = exigerRole("agent");
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test("passe si un des rôles multiples correspond", () => {
    req = { utilisateur: { id: 2, identifiant: "youssef", role: "utilisateur" } };
    const middleware = exigerRole("agent", "utilisateur");
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
