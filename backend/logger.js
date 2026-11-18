/**
 * logger.js – Logger structuré JSON pour HelpDesk DevSecOps
 *
 * Utilise Winston pour produire des logs JSON exploitables par Loki/Grafana.
 * Chaque log contient : timestamp, niveau, message, service, et les champs
 * métier (ip, utilisateur, route, security_event, etc.)
 */

const { createLogger, format, transports } = require("winston");

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(
    format.timestamp({ format: "ISO" }),
    format.errors({ stack: true }),
    format.json()
  ),
  defaultMeta: { service: "helpdesk-backend" },
  transports: [
    new transports.Console(),
  ],
});

// ── Helpers pour les événements de sécurité ─────────────────────────────

/**
 * Log un événement de sécurité (WARN ou ERROR selon la gravité)
 * Ces événements sont indexés avec security_event: true dans Grafana
 */
logger.security = function (level, message, meta = {}) {
  logger[level](message, {
    security_event: true,
    ...meta,
  });
};

module.exports = logger;
