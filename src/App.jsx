import { useEffect, useState, useCallback } from "react";
import "./App.css";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000/api";

// ─── Helpers API ──────────────────────────────────────────────────────────────
function entetes(token) {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function appelApi(url, options = {}) {
  const reponse = await fetch(url, options);
  const donnees = await reponse.json();
  if (!reponse.ok) throw new Error(donnees.message || "Erreur API");
  return donnees;
}

// ─── Composant principal ──────────────────────────────────────────────────────
function App() {
  // Auth
  const [token, setToken]               = useState(() => localStorage.getItem("hd_token") || "");
  const [utilisateur, setUtilisateur]   = useState(() => {
    try { return JSON.parse(localStorage.getItem("hd_user") || "null"); }
    catch { return null; }
  });
  const [identifiant, setIdentifiant]   = useState("agent");
  const [motDePasse, setMotDePasse]     = useState("");
  const [erreurConnexion, setErreurConnexion] = useState("");
  const [chargementLogin, setChargementLogin] = useState(false);

  // Tickets
  const [tickets, setTickets]           = useState([]);
  const [chargement, setChargement]     = useState(false);
  const [erreurApi, setErreurApi]       = useState("");

  // Filtres
  const [recherche, setRecherche]       = useState("");
  const [filtreStatut, setFiltreStatut] = useState("Tous");
  const [pageActive, setPageActive]     = useState("dashboard");

  // Modals
  const [formulaireOuvert, setFormulaireOuvert]   = useState(false);
  const [ticketSelectionne, setTicketSelectionne] = useState(null);
  const [nouveauStatut, setNouveauStatut]         = useState("Ouvert");

  // Commentaires
  const [commentaires, setCommentaires]         = useState([]);
  const [chargementComments, setChargementComments] = useState(false);
  const [nouveauComment, setNouveauComment]     = useState("");
  const [erreurComment, setErreurComment]       = useState("");

  // Formulaire nouveau ticket
  const [nouveauTicket, setNouveauTicket] = useState({
    titre: "", demandeur: "", categorie: "Compte", priorite: "Normale",
  });

  const connecte = !!token && !!utilisateur;
  const estAgent = utilisateur?.role === "agent";

  // ─── Chargement des tickets ────────────────────────────────────────────────
  const chargerTickets = useCallback(async (q = "") => {
    if (!token) return;
    setChargement(true);
    setErreurApi("");
    try {
      const url = q
        ? `${BASE_URL}/tickets?q=${encodeURIComponent(q)}`
        : `${BASE_URL}/tickets`;
      const donnees = await appelApi(url, { headers: entetes(token) });
      setTickets(donnees);
    } catch (err) {
      if (err.message.includes("401")) seDeconnecter();
      else setErreurApi(err.message || "Impossible de contacter le backend.");
    } finally {
      setChargement(false);
    }
  }, [token]);

  useEffect(() => {
    if (connecte) chargerTickets();
  }, [connecte, chargerTickets]);

  // ─── Connexion ─────────────────────────────────────────────────────────────
  async function seConnecter(event) {
    event.preventDefault();
    if (!identifiant.trim() || !motDePasse.trim()) {
      setErreurConnexion("Saisis l'identifiant et le mot de passe.");
      return;
    }
    setChargementLogin(true);
    setErreurConnexion("");
    try {
      const donnees = await appelApi(`${BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiant: identifiant.trim(), motDePasse }),
      });
      localStorage.setItem("hd_token", donnees.token);
      localStorage.setItem("hd_user", JSON.stringify(donnees.utilisateur));
      setToken(donnees.token);
      setUtilisateur(donnees.utilisateur);
    } catch (err) {
      setErreurConnexion(err.message || "Identifiant ou mot de passe incorrect.");
    } finally {
      setChargementLogin(false);
    }
  }

  // ─── Déconnexion ───────────────────────────────────────────────────────────
  function seDeconnecter() {
    if (token) {
      fetch(`${BASE_URL}/auth/logout`, { method: "POST", headers: entetes(token) })
        .catch(() => {});
    }
    localStorage.removeItem("hd_token");
    localStorage.removeItem("hd_user");
    setToken("");
    setUtilisateur(null);
    setMotDePasse("");
    setTickets([]);
    setTicketSelectionne(null);
    setPageActive("dashboard");
  }

  // ─── Créer ticket ──────────────────────────────────────────────────────────
  async function creerTicket(event) {
    event.preventDefault();
    setErreurApi("");
    try {
      const donnees = await appelApi(`${BASE_URL}/tickets`, {
        method: "POST",
        headers: entetes(token),
        body: JSON.stringify(nouveauTicket),
      });
      setTickets((liste) => [donnees, ...liste]);
      setNouveauTicket({ titre: "", demandeur: "", categorie: "Compte", priorite: "Normale" });
      setFormulaireOuvert(false);
      setPageActive("tickets");
    } catch (err) {
      setErreurApi(err.message);
    }
  }

  // ─── Modifier statut ───────────────────────────────────────────────────────
  async function mettreAJourStatut() {
    if (!ticketSelectionne) return;
    try {
      setErreurApi("");
      const donnees = await appelApi(
        `${BASE_URL}/tickets/${encodeURIComponent(ticketSelectionne.id)}/statut`,
        {
          method: "PATCH",
          headers: entetes(token),
          body: JSON.stringify({ statut: nouveauStatut }),
        }
      );
      setTickets((liste) => liste.map((t) => (t.id === donnees.id ? donnees : t)));
      setTicketSelectionne(donnees);
    } catch (err) {
      setErreurApi(err.message);
    }
  }

  // ─── Supprimer ticket ──────────────────────────────────────────────────────
  async function supprimerTicket() {
    if (!ticketSelectionne) return;
    if (!window.confirm(`Supprimer le ticket ${ticketSelectionne.id} ?`)) return;
    try {
      setErreurApi("");
      await appelApi(
        `${BASE_URL}/tickets/${encodeURIComponent(ticketSelectionne.id)}`,
        { method: "DELETE", headers: entetes(token) }
      );
      setTickets((liste) => liste.filter((t) => t.id !== ticketSelectionne.id));
      setTicketSelectionne(null);
    } catch (err) {
      setErreurApi(err.message);
    }
  }

  // ─── Ouvrir ticket (charge les commentaires) ───────────────────────────────
  async function ouvrirTicket(ticket) {
    setTicketSelectionne(ticket);
    setNouveauStatut(ticket.statut);
    setErreurApi("");
    setCommentaires([]);
    setNouveauComment("");
    setErreurComment("");
    setChargementComments(true);
    try {
      const donnees = await appelApi(
        `${BASE_URL}/tickets/${encodeURIComponent(ticket.id)}/comments`,
        { headers: entetes(token) }
      );
      setCommentaires(donnees);
    } catch (err) {
      setErreurComment(err.message);
    } finally {
      setChargementComments(false);
    }
  }

  // ─── Ajouter commentaire ───────────────────────────────────────────────────
  async function ajouterCommentaire(event) {
    event.preventDefault();
    if (!nouveauComment.trim()) return;
    setErreurComment("");
    try {
      const donnees = await appelApi(
        `${BASE_URL}/tickets/${encodeURIComponent(ticketSelectionne.id)}/comments`,
        {
          method: "POST",
          headers: entetes(token),
          body: JSON.stringify({ contenu: nouveauComment.trim() }),
        }
      );
      setCommentaires((liste) => [...liste, donnees]);
      setNouveauComment("");
    } catch (err) {
      setErreurComment(err.message);
    }
  }

  // ─── Recherche ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!connecte) return;
    const delai = setTimeout(() => chargerTickets(recherche), 400);
    return () => clearTimeout(delai);
  }, [recherche, connecte, chargerTickets]);

  // ─── Filtres locaux ────────────────────────────────────────────────────────
  const ticketsFiltres = tickets.filter((ticket) => {
    if (filtreStatut === "Tous") return true;
    return ticket.statut === filtreStatut;
  });

  const stats = {
    total: tickets.length,
    ouverts: tickets.filter((t) => t.statut === "Ouvert").length,
    enCours: tickets.filter((t) => t.statut === "En cours").length,
    resolus: tickets.filter((t) => t.statut === "Résolu").length,
  };

  // ─── PAGE DE CONNEXION ─────────────────────────────────────────────────────
  if (!connecte) {
    return (
      <main className="login-page">
        <section className="login-card">
          <div className="login-logo">H</div>
          <h1>HelpDesk</h1>
          <p className="login-description">Connecte-toi à ton espace de support.</p>

          <form className="login-form" onSubmit={seConnecter}>
            <label htmlFor="identifiant">Identifiant</label>
            <input
              id="identifiant"
              type="text"
              value={identifiant}
              onChange={(e) => setIdentifiant(e.target.value)}
              placeholder="Saisis ton identifiant"
              autoComplete="username"
              required
            />

            <label htmlFor="motDePasse">Mot de passe</label>
            <input
              id="motDePasse"
              type="password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              placeholder="Saisis ton mot de passe"
              autoComplete="current-password"
              required
            />

            {erreurConnexion && <p className="login-error">{erreurConnexion}</p>}

            <button className="login-button" type="submit" disabled={chargementLogin}>
              {chargementLogin ? "Connexion..." : "Se connecter"}
            </button>
          </form>

          <div className="demo-comptes">
            <p className="demo-note">Comptes de démonstration :</p>
            <div className="demo-grid">
              <div className="demo-compte">
                <span className="role-badge role-agent">Agent</span>
                <code>agent</code> / <code>agent1234</code>
              </div>
              <div className="demo-compte">
                <span className="role-badge role-utilisateur">Utilisateur</span>
                <code>youssef</code> / <code>user1234</code>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  // ─── APPLICATION PRINCIPALE ────────────────────────────────────────────────
  const initiales = utilisateur.identifiant.slice(0, 2).toUpperCase();
  const titrePage = { dashboard: "Tableau de bord", tickets: "Tous les tickets", mine: "Mes tickets", settings: "Paramètres" }[pageActive];

  return (
    <div className="application">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-icon">H</div>
          <span>HelpDesk</span>
        </div>

        <p className="menu-titre">MENU</p>

        <nav className="menu">
          <button className={`menu-item ${pageActive === "dashboard" ? "actif" : ""}`} onClick={() => setPageActive("dashboard")}>
            ▦ Tableau de bord
          </button>
          <button className={`menu-item ${pageActive === "tickets" ? "actif" : ""}`} onClick={() => setPageActive("tickets")}>
            ▤ {estAgent ? "Tous les tickets" : "Mes tickets"}
          </button>
          {!estAgent && (
            <button className={`menu-item ${pageActive === "mine" ? "actif" : ""}`} onClick={() => setPageActive("mine")}>
              ◷ Mes demandes
            </button>
          )}
          <button className={`menu-item ${pageActive === "settings" ? "actif" : ""}`} onClick={() => setPageActive("settings")}>
            ⚙ Paramètres
          </button>
        </nav>

        <div className="profil">
          <div className="avatar">{initiales}</div>
          <div className="profil-info">
            <strong>{utilisateur.identifiant}</strong>
            <span className={`role-badge ${estAgent ? "role-agent" : "role-utilisateur"}`}>
              {estAgent ? "Agent" : "Utilisateur"}
            </span>
          </div>
          <button className="logout-button" onClick={seDeconnecter}>Déconnexion</button>
        </div>
      </aside>

      {/* ── Contenu principal ── */}
      <main className="contenu">
        <header className="entete">
          <div>
            <p className="date">ESPACE SUPPORT</p>
            <h1>{titrePage}</h1>
            <p className="sous-titre">Suivez et gérez les demandes d'assistance.</p>
          </div>

          {pageActive !== "settings" && (
            <button className="bouton-principal" onClick={() => { setErreurApi(""); setFormulaireOuvert(true); }}>
              <span>＋</span> Nouveau ticket
            </button>
          )}
        </header>

        {erreurApi && <p className="login-error">{erreurApi}</p>}

        {/* ── Dashboard ── */}
        {pageActive === "dashboard" && (
          <section className="cartes-statistiques">
            <article className="carte-statistique">
              <span className="statistique-label">Total</span>
              <strong>{stats.total}</strong>
              <span className="statistique-note">Toutes catégories</span>
            </article>
            <article className="carte-statistique">
              <span className="statistique-label">Ouverts</span>
              <strong>{stats.ouverts}</strong>
              <span className="statistique-note">À traiter</span>
            </article>
            <article className="carte-statistique">
              <span className="statistique-label">En cours</span>
              <strong>{stats.enCours}</strong>
              <span className="statistique-note">En traitement</span>
            </article>
            <article className="carte-statistique">
              <span className="statistique-label">Résolus</span>
              <strong>{stats.resolus}</strong>
              <span className="statistique-note">Terminés</span>
            </article>
          </section>
        )}

        {/* ── Paramètres ── */}
        {pageActive === "settings" ? (
          <section className="section-tickets">
            <h2>Paramètres du compte</h2>
            <p>Connecté en tant que <strong>{utilisateur.identifiant}</strong> ({estAgent ? "Agent" : "Utilisateur"}).</p>
            <button className="bouton-secondaire" onClick={seDeconnecter}>Se déconnecter</button>
          </section>
        ) : (
          /* ── Liste de tickets ── */
          <section className="section-tickets">
            <div className="section-entete">
              <div>
                <h2>{pageActive === "dashboard" ? "Tickets récents" : estAgent ? "Liste des tickets" : "Mes tickets"}</h2>
                <p>Consulte les demandes d'assistance.</p>
              </div>
              <button className="bouton-secondaire" onClick={() => { setPageActive("tickets"); setRecherche(""); setFiltreStatut("Tous"); }}>
                Voir tous
              </button>
            </div>

            <div className="outils-tickets">
              <input
                type="search"
                placeholder="Rechercher un ticket..."
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
              />
              <select value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value)}>
                <option value="Tous">Tous les statuts</option>
                <option value="Ouvert">Ouvert</option>
                <option value="En cours">En cours</option>
                <option value="Résolu">Résolu</option>
              </select>
            </div>

            <div className="tableau-conteneur">
              <table>
                <thead>
                  <tr>
                    <th>N° TICKET</th>
                    <th>SUJET</th>
                    {estAgent && <th>DEMANDEUR</th>}
                    <th>CATÉGORIE</th>
                    <th>PRIORITÉ</th>
                    <th>STATUT</th>
                    <th>DÉTAILS</th>
                  </tr>
                </thead>
                <tbody>
                  {chargement ? (
                    <tr><td colSpan={estAgent ? 7 : 6} className="aucun-resultat">Chargement...</td></tr>
                  ) : ticketsFiltres.length === 0 ? (
                    <tr><td colSpan={estAgent ? 7 : 6} className="aucun-resultat">Aucun ticket à afficher.</td></tr>
                  ) : (
                    ticketsFiltres.map((ticket) => (
                      <tr key={ticket.id}>
                        <td className="numero-ticket">{ticket.id}</td>
                        <td className="titre-ticket">{ticket.titre}</td>
                        {estAgent && <td>{ticket.demandeur}</td>}
                        <td>{ticket.categorie}</td>
                        <td><span className={`priorite ${ticket.priorite.toLowerCase()}`}>{ticket.priorite}</span></td>
                        <td><span className={`statut ${ticket.statut.toLowerCase().replace(" ", "-")}`}>{ticket.statut}</span></td>
                        <td>
                          <button className="bouton-details" onClick={() => ouvrirTicket(ticket)}>Détails</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      {/* ── Modal – Détail ticket ── */}
      {ticketSelectionne && (
        <div className="modal-fond" onClick={() => setTicketSelectionne(null)}>
          <section className="modal modal-large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-entete">
              <div>
                <h2>Détails du ticket</h2>
                <p>{ticketSelectionne.id}</p>
              </div>
              <button className="fermer-modal" onClick={() => setTicketSelectionne(null)} aria-label="Fermer">×</button>
            </div>

            <div className="modal-corps-deux-colonnes">
              {/* Colonne gauche – infos + actions */}
              <div>
                <div className="details-ticket">
                  <p><strong>Sujet :</strong> {ticketSelectionne.titre}</p>
                  <p><strong>Demandeur :</strong> {ticketSelectionne.demandeur}</p>
                  <p><strong>Catégorie :</strong> {ticketSelectionne.categorie}</p>
                  <p><strong>Priorité :</strong> {ticketSelectionne.priorite}</p>
                  <p><strong>Statut :</strong> {ticketSelectionne.statut}</p>
                </div>

                {estAgent && (
                  <>
                    <label>
                      Modifier le statut
                      <select value={nouveauStatut} onChange={(e) => setNouveauStatut(e.target.value)}>
                        <option value="Ouvert">Ouvert</option>
                        <option value="En cours">En cours</option>
                        <option value="Résolu">Résolu</option>
                      </select>
                    </label>

                    <div className="modal-actions">
                      <button className="bouton-secondaire" onClick={() => setTicketSelectionne(null)}>Fermer</button>
                      <button className="bouton-principal" onClick={mettreAJourStatut}>Enregistrer</button>
                      <button className="bouton-danger" onClick={supprimerTicket}>Supprimer</button>
                    </div>
                  </>
                )}

                {!estAgent && (
                  <div className="modal-actions">
                    <button className="bouton-secondaire" onClick={() => setTicketSelectionne(null)}>Fermer</button>
                  </div>
                )}
              </div>

              {/* Colonne droite – commentaires */}
              <div className="section-commentaires">
                <h3>Commentaires</h3>

                {chargementComments && <p className="aucun-resultat">Chargement...</p>}

                {!chargementComments && commentaires.length === 0 && (
                  <p className="aucun-resultat">Aucun commentaire pour l'instant.</p>
                )}

                <div className="liste-commentaires">
                  {commentaires.map((c) => (
                    <div key={c.id} className={`commentaire ${c.auteur === utilisateur.identifiant ? "mien" : ""}`}>
                      <div className="commentaire-entete">
                        <strong>{c.auteur}</strong>
                        <time>{new Date(c.created_at).toLocaleString("fr-FR")}</time>
                      </div>
                      <p>{c.contenu}</p>
                    </div>
                  ))}
                </div>

                {erreurComment && <p className="login-error">{erreurComment}</p>}

                <form className="form-commentaire" onSubmit={ajouterCommentaire}>
                  <textarea
                    value={nouveauComment}
                    onChange={(e) => setNouveauComment(e.target.value)}
                    placeholder="Écrire un commentaire..."
                    rows={3}
                    maxLength={2000}
                    required
                  />
                  <button type="submit" className="bouton-principal" disabled={!nouveauComment.trim()}>
                    Envoyer
                  </button>
                </form>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ── Modal – Nouveau ticket ── */}
      {formulaireOuvert && (
        <div className="modal-fond" onClick={() => setFormulaireOuvert(false)}>
          <section className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-entete">
              <div>
                <h2>Créer un ticket</h2>
                <p>Remplis les informations de la demande.</p>
              </div>
              <button className="fermer-modal" onClick={() => setFormulaireOuvert(false)} aria-label="Fermer">×</button>
            </div>

            <form onSubmit={creerTicket}>
              {erreurApi && <p className="login-error">{erreurApi}</p>}

              <label>
                Sujet du ticket
                <input name="titre" value={nouveauTicket.titre} onChange={(e) => setNouveauTicket((t) => ({ ...t, titre: e.target.value }))} placeholder="Ex. Problème de connexion" required />
              </label>

              <label>
                Nom du demandeur
                <input name="demandeur" value={nouveauTicket.demandeur} onChange={(e) => setNouveauTicket((t) => ({ ...t, demandeur: e.target.value }))} placeholder="Ex. Alex Martin" required />
              </label>

              <label>
                Catégorie
                <select name="categorie" value={nouveauTicket.categorie} onChange={(e) => setNouveauTicket((t) => ({ ...t, categorie: e.target.value }))}>
                  <option>Compte</option>
                  <option>Logiciel</option>
                  <option>Matériel</option>
                  <option>Réseau</option>
                </select>
              </label>

              <label>
                Priorité
                <select name="priorite" value={nouveauTicket.priorite} onChange={(e) => setNouveauTicket((t) => ({ ...t, priorite: e.target.value }))}>
                  <option>Basse</option>
                  <option>Normale</option>
                  <option>Haute</option>
                </select>
              </label>

              <div className="modal-actions">
                <button type="button" className="bouton-secondaire" onClick={() => setFormulaireOuvert(false)}>Annuler</button>
                <button type="submit" className="bouton-principal">Créer le ticket</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;