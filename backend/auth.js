/**
 * auth.js – Middleware d'authentification JWT
 *
 * Rôles supportés :
 *   - "utilisateur" : voit uniquement ses propres tickets
 *   - "agent"       : voit tous les tickets, peut modifier les statuts
 */

const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "devsecops-secret-change-in-prod";
const JWT_EXPIRES_IN = "8h";

/**
 * Génère un token JWT signé pour un utilisateur.
 * @param {{ id: number, identifiant: string, role: string }} utilisateur
 * @returns {string} token JWT
 */
function signerToken(utilisateur) {
  return jwt.sign(
    {
      id: utilisateur.id,
      identifiant: utilisateur.identifiant,
      role: utilisateur.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Middleware Express : vérifie le token JWT dans le header Authorization.
 * Injecte req.utilisateur si le token est valide.
 */
function verifierToken(req, res, next) {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Token manquant ou invalide." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.utilisateur = payload;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Session expirée. Reconnecte-toi." });
    }
    return res.status(401).json({ message: "Token invalide." });
  }
}

/**
 * Middleware Express : vérifie que l'utilisateur possède le rôle requis.
 * Doit être utilisé APRÈS verifierToken.
 * @param {...string} rolesAutorises - Rôles qui ont accès à la route.
 */
function exigerRole(...rolesAutorises) {
  return (req, res, next) => {
    if (!req.utilisateur) {
      return res.status(401).json({ message: "Non authentifié." });
    }

    if (!rolesAutorises.includes(req.utilisateur.role)) {
      return res.status(403).json({
        message: `Accès refusé. Rôle requis : ${rolesAutorises.join(" ou ")}.`,
      });
    }

    next();
  };
}

module.exports = { signerToken, verifierToken, exigerRole };
