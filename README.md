# 🛡️ HelpDesk DevSecOps

> Application web sécurisée de gestion de tickets — 4 failles (SQLi, XSS, IDOR, Secret) — Docker — CI/CD — Kubernetes — DAST

---

## 📋 Table des matières

- [Présentation](#-présentation)
- [Stack technique](#-stack-technique)
- [Architecture](#-architecture)
- [Fonctionnalités](#-fonctionnalités)
- [4 Failles de sécurité](#-4-failles-de-sécurité-intentionnelles)
- [Pipeline CI/CD](#-pipeline-cicd-9-stages)
- [Kubernetes](#-kubernetes)
- [Lancement](#-lancement)
- [Tests](#-tests)
- [Structure du projet](#-structure-du-projet)
- [Variables GitLab CI](#-variables-gitlab-ci-protégées)

---

## 🎯 Présentation

Ce projet est une application **HelpDesk** (gestion de tickets d'assistance) conçue dans une démarche **DevSecOps**. Il intègre :

- Une application web complète (frontend React + backend Express + PostgreSQL)
- **4 failles de sécurité intentionnelles** introduites puis corrigées
- Un pipeline **GitLab CI/CD à 9 stages bloquants**
- Un déploiement **Kubernetes** sécurisé (NetworkPolicy, RBAC, SecurityContext, Secrets)
- Des scans de sécurité automatisés (SAST, secrets, dépendances, images, DAST)

---

## 🔧 Stack technique

| Couche | Technologie |
|---|---|
| **Frontend** | React 19 + Vite 8 (SPA) |
| **Backend** | Node.js + Express 5 (API REST) |
| **Base de données** | PostgreSQL 17 (Alpine) |
| **Auth** | JWT (jsonwebtoken + bcryptjs) |
| **Reverse proxy** | Nginx (unprivileged) |
| **Conteneurisation** | Docker + docker-compose |
| **Orchestration** | Kubernetes (kind / Minikube) |
| **CI/CD** | GitLab CI (9 stages) |
| **SAST** | Semgrep (OWASP Top 10) |
| **Secrets** | Gitleaks |
| **Dépendances** | npm audit |
| **Image scan** | Trivy |
| **DAST** | OWASP ZAP |
| **Lint** | Oxlint (frontend) + Jest (backend) |

---

## 🏗️ Architecture

```
                    ┌──────────────┐
                    │  Navigateur  │
                    │  (HTTP/S)    │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │    Nginx     │
                    │  (port 8080) │
                    │  reverse     │
                    │  proxy       │
                    └──┬───────┬───┘
                       │       │
              /api/*   │       │   /*
                       │       │
              ┌────────▼──┐  ┌─▼──────────┐
              │  Backend  │  │  Frontend   │
              │  Express  │  │  React/Vite │
              │  (3000)   │  │  (statique) │
              └────┬──────┘  └─────────────┘
                   │
              ┌────▼──────┐
              │ PostgreSQL │
              │  (5432)    │
              └────────────┘
```

---

## ✨ Fonctionnalités

### Authentification
- Connexion JWT avec 2 rôles :
  - **Agent** : voit tous les tickets, modifie les statuts, supprime
  - **Utilisateur** : voit uniquement ses propres tickets

### Comptes de démonstration

| Rôle | Identifiant | Mot de passe |
|---|---|---|
| 🔵 Agent | `agent` | `agent1234` |
| 🟢 Utilisateur | `youssef` | `user1234` |

### Gestion de tickets
- ✅ Créer un ticket (titre, demandeur, catégorie, priorité)
- ✅ Lister les tickets (avec filtrage par rôle)
- ✅ Rechercher par mot-clé (`?q=`)
- ✅ Modifier le statut (Ouvert → En cours → Résolu)
- ✅ Supprimer un ticket (agent uniquement)
- ✅ Commentaires sur les tickets
- ✅ Dashboard avec statistiques

---

## 🔓 4 Failles de sécurité intentionnelles

Le fichier `backend/server.vulnerable.js` contient **4 failles** volontaires. Le fichier `backend/server.js` contient les **correctifs**.

### Faille 1 : SQL Injection

| | Détail |
|---|---|
| **Vulnérable** | Concaténation directe dans la requête SQL |
| **Attaque** | `GET /api/tickets?q=' OR 1=1 --` |
| **Corrigé** | Requêtes paramétrées `$1`, `$2` |

```js
// ❌ server.vulnerable.js — VULNÉRABLE
const query = `SELECT * FROM tickets WHERE titre ILIKE '%${q}%'`;

// ✅ server.js — CORRIGÉ
const query = `SELECT * FROM tickets WHERE titre ILIKE $1`;
const params = [`%${q}%`];
```

### Faille 2 : XSS Stocké

| | Détail |
|---|---|
| **Vulnérable** | Commentaires rendus en HTML sans échappement |
| **Attaque** | `POST contenu: "<script>alert('XSS')</script>"` |
| **Corrigé** | Sanitization des entrées + React échappe automatiquement |

```js
// ❌ server.vulnerable.js — VULNÉRABLE
html += `<p>${c.contenu}</p>`; // Injection HTML directe

// ✅ server.js — CORRIGÉ
// Pas de rendu HTML côté serveur + React échappe le contenu
res.status(201).json(r.rows[0]); // JSON uniquement
```

### Faille 3 : IDOR (Insecure Direct Object Reference)

| | Détail |
|---|---|
| **Vulnérable** | Pas de vérification du propriétaire du ticket |
| **Attaque** | Un utilisateur accède au ticket d'un autre via `GET /api/tickets/HD-1042` |
| **Corrigé** | Vérification `demandeur === req.utilisateur.identifiant` |

```js
// ❌ server.vulnerable.js — VULNÉRABLE
res.json(resultat.rows[0]); // Pas de contrôle d'accès

// ✅ server.js — CORRIGÉ
if (req.utilisateur.role === "utilisateur" &&
    ticket.demandeur.toLowerCase() !== req.utilisateur.identifiant.toLowerCase()) {
  return res.status(403).json({ message: "Accès refusé." });
}
```

### Faille 4 : Secret exposé + Debug

| | Détail |
|---|---|
| **Vulnérable** | Clé JWT en dur dans le code + stack trace dans les réponses d'erreur |
| **Attaque** | Lecture du dépôt → forge de tokens JWT ; erreur → structure du code |
| **Corrigé** | `process.env.JWT_SECRET` + error handler sans info sensible |

```js
// ❌ server.vulnerable.js — VULNÉRABLE
const JWT_SECRET = "super-secret-helpdesk-key-2024";
res.status(500).json({ error: err.message, stack: err.stack });

// ✅ server.js — CORRIGÉ (auth.js)
const JWT_SECRET = process.env.JWT_SECRET || "devsecops-secret-change-in-prod";
res.status(500).json({ message: "Erreur interne du serveur." });
```

---

## 🔄 Pipeline CI/CD (9 stages)

Pipeline **bloquant** : si une étape échoue, les suivantes ne démarrent pas.

```
Build → Test → SAST → Secrets → Deps → Image → Image Scan → Deploy → DAST
```

| # | Stage | Outil | Description |
|---|---|---|---|
| 1 | **Build** | npm / vite | Compile le frontend + installe le backend |
| 2 | **Test** | oxlint / jest | Lint frontend + tests unitaires backend |
| 3 | **SAST** | Semgrep | Analyse statique (OWASP Top 10 + JS + Node.js) |
| 4 | **Secrets** | Gitleaks | Détection de secrets dans le code et l'historique |
| 5 | **Deps** | npm audit | Vulnérabilités dans les dépendances (HIGH+) |
| 6 | **Image** | Docker | Build & push des images vers GitLab Registry |
| 7 | **Image Scan** | Trivy | Scan des images Docker (HIGH/CRITICAL) |
| 8 | **Deploy** | kubectl | Déploiement sur Kubernetes (branche `main`) |
| 9 | **DAST** | OWASP ZAP | Scan dynamique de l'application déployée |

---

## ☸️ Kubernetes

### Namespace : `helpdesk`

| Composant | Ressource | Description |
|---|---|---|
| **web** | Deployment + Service (8080) | Nginx avec frontend React |
| **backend** | Deployment + Service (3000) | Express API REST |
| **db** | Deployment + Service (5432) + PVC | PostgreSQL avec stockage persistant |

### Sécurité Kubernetes

| Protection | Détail |
|---|---|
| **SecurityContext** | `runAsNonRoot: true`, `runAsUser: 1000`, `readOnlyRootFilesystem` |
| **Secrets** | `DB_PASSWORD` via Kubernetes Secrets (non versionnés) |
| **NetworkPolicy** | Deny-all par défaut + autorisations explicites (web→backend→db) |
| **RBAC** | 3 ServiceAccounts : `helpdesk-backend`, `helpdesk-web`, `helpdesk-deploy` |
| **Ingress** | Accès HTTP/HTTPS externe (optionnel) |

### Flux réseau autorisés

```
Internet → Ingress → web (8080) → backend (3000) → db (5432)
```

---

## 🚀 Lancement

### Avec Docker Compose (recommandé)

```bash
# Cloner le dépôt
git clone https://gitlab.com/YOUR_GROUP/helpdesk-devsecops.git
cd helpdesk-devsecops

# Créer le fichier .env
cp .env.example .env
# Modifier DB_PASSWORD et JWT_SECRET dans .env

# Lancer l'application
docker-compose up --build

# Accéder à l'application
# → http://localhost:8080
```

### En développement local

```bash
# Terminal 1 : Backend
cd backend
cp .env.example .env  # ou créer .env avec les variables
npm install
npm start

# Terminal 2 : Frontend
npm install
npm run dev

# → http://localhost:5173
```

### Version vulnérable (test uniquement)

```bash
cd backend
npm run start:vulnerable
# ⚠️ NE JAMAIS utiliser en production !
```

---

## 🧪 Tests

```bash
# Tests unitaires backend
cd backend
npm test

# Lint frontend
npm run lint
```

Les tests couvrent :
- **auth.test.js** : JWT (génération, vérification, rôles)
- **tickets.test.js** : CRUD tickets, validation, contrôle d'accès IDOR
- **security.test.js** : Vérification que `server.js` est sécurisé et que `server.vulnerable.js` contient bien les 4 failles

---

## 📁 Structure du projet

```
helpdesk_devsecops/
├── backend/
│   ├── server.js              # ✅ Version sécurisée
│   ├── server.vulnerable.js   # ❌ Version vulnérable (4 failles)
│   ├── auth.js                # Middleware JWT (signerToken, verifierToken, exigerRole)
│   ├── db.js                  # Connexion PostgreSQL (pg Pool)
│   ├── tests/
│   │   ├── auth.test.js       # Tests authentification
│   │   ├── tickets.test.js    # Tests tickets + IDOR
│   │   └── security.test.js   # Tests sécurité (analyse statique)
│   ├── Dockerfile             # Image Node.js (non-root, healthcheck)
│   └── package.json
├── src/
│   ├── App.jsx                # Application React (SPA)
│   ├── App.css                # Styles
│   └── main.jsx               # Point d'entrée
├── k8s/
│   ├── namespace.yaml
│   ├── deployment-backend.yaml
│   ├── deployment-db.yaml
│   ├── deployment-web.yaml
│   ├── service-backend.yaml
│   ├── service-db.yaml
│   ├── service-web.yaml
│   ├── secret.yaml
│   ├── networkpolicy.yaml     # Deny-all + autorisations
│   ├── rbac.yaml              # 3 ServiceAccounts + Role + RoleBinding
│   └── ingress.yaml
├── nginx/
│   └── nginx.conf             # Reverse proxy + en-têtes sécurité
├── docker-compose.yml         # 3 services : db, backend, web
├── Dockerfile                 # Frontend (multi-stage: build Vite + Nginx)
├── .gitlab-ci.yml             # Pipeline 9 stages bloquants
├── .env.example               # Variables d'environnement (template)
└── README.md
```

---

## 🔐 Variables GitLab CI protégées

Configurer dans **Settings → CI/CD → Variables** (Masked + Protected) :

| Variable | Description | Type |
|---|---|---|
| `DB_PASSWORD` | Mot de passe PostgreSQL | Variable |
| `JWT_SECRET` | Clé de signature JWT | Variable |
| `KUBE_CONFIG` | Kubeconfig du cluster | File |
| `DAST_TARGET_URL` | URL cible pour OWASP ZAP | Variable |

---

## 🔄 Rotation des secrets

1. **Révoquer** : invalider l'ancien secret
2. **Remplacer** : générer un nouveau secret dans GitLab CI/CD
3. **Nettoyer** : supprimer les anciens tokens/sessions

---

## 📝 Politique de blocage

- ❌ Pas de secrets dans le code
- ❌ Pas de dépendances avec vulnérabilités HIGH/CRITICAL
- ❌ Scan SAST / DAST obligatoire avant déploiement
- ✅ Pipeline 100% bloquant

---

> **Mots-clés** : Sécurité · Automatisation · Conteneurisation · Orchestration · Surveillance
