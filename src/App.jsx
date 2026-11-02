import { useEffect, useState } from "react";
import "./App.css";

const API_URL = "http://localhost:3000/api/tickets";

function App() {
  const [connecte, setConnecte] = useState(false);
  const [identifiant, setIdentifiant] = useState("admin");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreurConnexion, setErreurConnexion] = useState("");

  const [tickets, setTickets] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreurApi, setErreurApi] = useState("");

  const [recherche, setRecherche] = useState("");
  const [filtreStatut, setFiltreStatut] = useState("Tous");
  const [pageActive, setPageActive] = useState("dashboard");

  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [ticketSelectionne, setTicketSelectionne] = useState(null);
  const [nouveauStatut, setNouveauStatut] = useState("Ouvert");

  const [nouveauTicket, setNouveauTicket] = useState({
    titre: "",
    demandeur: "",
    categorie: "Compte",
    priorite: "Normale",
  });

  useEffect(() => {
    async function chargerTickets() {
      try {
        setErreurApi("");

        const reponse = await fetch(API_URL);

        if (!reponse.ok) {
          throw new Error("Le serveur n’a pas pu charger les tickets.");
        }

        const donnees = await reponse.json();
        setTickets(donnees);
      } catch (erreur) {
        setErreurApi(
          "Impossible de contacter le backend. Vérifie que son terminal est ouvert."
        );
      } finally {
        setChargement(false);
      }
    }

    chargerTickets();
  }, []);

  function seConnecter(event) {
    event.preventDefault();

    if (!identifiant.trim() || !motDePasse.trim()) {
      setErreurConnexion("Saisis l’identifiant et le mot de passe.");
      return;
    }

    if (identifiant.trim().toLowerCase() !== "admin") {
      setErreurConnexion(
        "Pour cette démonstration, utilise l’identifiant admin."
      );
      return;
    }

    setErreurConnexion("");
    setConnecte(true);
  }

  function seDeconnecter() {
    setConnecte(false);
    setMotDePasse("");
    setPageActive("dashboard");
  }

  function modifierChampTicket(event) {
    const { name, value } = event.target;

    setNouveauTicket((ticket) => ({
      ...ticket,
      [name]: value,
    }));
  }

  async function creerTicket(event) {
    event.preventDefault();
    setErreurApi("");

    try {
      const reponse = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(nouveauTicket),
      });

      const donnees = await reponse.json();

      if (!reponse.ok) {
        throw new Error(donnees.message || "La création du ticket a échoué.");
      }

      setTickets((liste) => [donnees, ...liste]);

      setNouveauTicket({
        titre: "",
        demandeur: "",
        categorie: "Compte",
        priorite: "Normale",
      });

      setPageActive("tickets");
      setRecherche("");
      setFiltreStatut("Tous");
      setFormulaireOuvert(false);
    } catch (erreur) {
      setErreurApi(
        erreur.message ||
          "Impossible d’enregistrer le ticket auprès du backend."
      );
    }
  }

  async function mettreAJourStatut() {
    if (!ticketSelectionne) return;

    try {
      setErreurApi("");

      const reponse = await fetch(
        `${API_URL}/${encodeURIComponent(ticketSelectionne.id)}/statut`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ statut: nouveauStatut }),
        }
      );

      const donnees = await reponse.json();

      if (!reponse.ok) {
        throw new Error(donnees.message || "La modification a échoué.");
      }

      setTickets((liste) =>
        liste.map((ticket) =>
          ticket.id === donnees.id ? donnees : ticket
        )
      );

      setTicketSelectionne(donnees);
      setNouveauStatut(donnees.statut);
    } catch (erreur) {
      setErreurApi(erreur.message || "Impossible de modifier le statut.");
    }
  }

  async function supprimerTicket() {
  if (!ticketSelectionne) return;

  const confirmation = window.confirm(
    `Veux-tu supprimer le ticket ${ticketSelectionne.id} ?`
  );

  if (!confirmation) return;

  try {
    setErreurApi("");

    const reponse = await fetch(
      `${API_URL}/${encodeURIComponent(ticketSelectionne.id)}`,
      { method: "DELETE" }
    );

    const donnees = await reponse.json();

    if (!reponse.ok) {
      throw new Error(donnees.message || "La suppression a échoué.");
    }

    setTickets((liste) =>
      liste.filter((ticket) => ticket.id !== ticketSelectionne.id)
    );

    setTicketSelectionne(null);
  } catch (erreur) {
    setErreurApi(erreur.message || "Impossible de supprimer le ticket.");
  }
}

  const ticketsSource =
    pageActive === "mine"
      ? tickets.filter(
          (ticket) =>
            ticket.demandeur.toLowerCase() ===
            identifiant.trim().toLowerCase()
        )
      : tickets;

  const ticketsFiltres = ticketsSource.filter((ticket) => {
    const texte = recherche.toLowerCase();

    const correspondRecherche =
      ticket.titre.toLowerCase().includes(texte) ||
      ticket.id.toLowerCase().includes(texte) ||
      ticket.demandeur.toLowerCase().includes(texte);

    const correspondStatut =
      filtreStatut === "Tous" || ticket.statut === filtreStatut;

    return correspondRecherche && correspondStatut;
  });

  const titrePage = {
    dashboard: "Tableau de bord",
    tickets: "Tous les tickets",
    mine: "Mes tickets",
    settings: "Paramètres",
  }[pageActive];

  if (!connecte) {
    return (
      <main className="login-page">
        <section className="login-card">
          <div className="login-logo">H</div>
          <h1>HelpDesk</h1>
          <p className="login-description">
            Connecte-toi à ton espace de support.
          </p>

          <form className="login-form" onSubmit={seConnecter}>
            <label htmlFor="identifiant">Identifiant</label>
            <input
              id="identifiant"
              type="text"
              value={identifiant}
              onChange={(event) => setIdentifiant(event.target.value)}
              placeholder="Saisis ton identifiant"
              autoComplete="username"
              required
            />

            <label htmlFor="motDePasse">Mot de passe</label>
            <input
              id="motDePasse"
              type="password"
              value={motDePasse}
              onChange={(event) => setMotDePasse(event.target.value)}
              placeholder="Saisis ton mot de passe"
              autoComplete="current-password"
              required
            />

            {erreurConnexion && (
              <p className="login-error">{erreurConnexion}</p>
            )}

            <button className="login-button" type="submit">
              Se connecter
            </button>
          </form>

          <p className="demo-note">
            Démonstration : identifiant <strong>admin</strong> et mot de passe
            non vide.
          </p>
        </section>
      </main>
    );
  }

  return (
    <div className="application">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-icon">H</div>
          <span>HelpDesk</span>
        </div>

        <p className="menu-titre">MENU</p>

        <nav className="menu">
          <button
            className={`menu-item ${pageActive === "dashboard" ? "actif" : ""}`}
            onClick={() => setPageActive("dashboard")}
          >
            ▦ Tableau de bord
          </button>

          <button
            className={`menu-item ${pageActive === "tickets" ? "actif" : ""}`}
            onClick={() => setPageActive("tickets")}
          >
            ▤ Tous les tickets
          </button>

          <button
            className={`menu-item ${pageActive === "mine" ? "actif" : ""}`}
            onClick={() => setPageActive("mine")}
          >
            ◷ Mes tickets
          </button>

          <button
            className={`menu-item ${pageActive === "settings" ? "actif" : ""}`}
            onClick={() => setPageActive("settings")}
          >
            ⚙ Paramètres
          </button>
        </nav>

        <div className="profil">
          <div className="avatar">AD</div>
          <div className="profil-info">
            <strong>admin</strong>
            <span>Administrateur</span>
          </div>
          <button className="logout-button" onClick={seDeconnecter}>
            Déconnexion
          </button>
        </div>
      </aside>

      <main className="contenu">
        <header className="entete">
          <div>
            <p className="date">ESPACE SUPPORT</p>
            <h1>{titrePage}</h1>
            <p className="sous-titre">
              Suivez et gérez les demandes d’assistance.
            </p>
          </div>

          {pageActive !== "settings" && (
            <button
              className="bouton-principal"
              onClick={() => {
                setErreurApi("");
                setFormulaireOuvert(true);
              }}
            >
              <span>＋</span> Nouveau ticket
            </button>
          )}
        </header>

        {erreurApi && <p className="login-error">{erreurApi}</p>}

        {pageActive === "dashboard" && (
          <section className="cartes-statistiques">
            <article className="carte-statistique">
              <span className="statistique-label">Total des tickets</span>
              <strong>{tickets.length}</strong>
              <span className="statistique-note">Toutes catégories</span>
            </article>

            <article className="carte-statistique">
              <span className="statistique-label">Tickets ouverts</span>
              <strong>
                {tickets.filter((ticket) => ticket.statut === "Ouvert").length}
              </strong>
              <span className="statistique-note">À traiter par l’équipe</span>
            </article>

            <article className="carte-statistique">
              <span className="statistique-label">En cours</span>
              <strong>
                {tickets.filter((ticket) => ticket.statut === "En cours").length}
              </strong>
              <span className="statistique-note">En cours de traitement</span>
            </article>

            <article className="carte-statistique">
              <span className="statistique-label">Tickets résolus</span>
              <strong>
                {tickets.filter((ticket) => ticket.statut === "Résolu").length}
              </strong>
              <span className="statistique-note">Demandes terminées</span>
            </article>
          </section>
        )}

        {pageActive === "settings" ? (
          <section className="section-tickets">
            <h2>Paramètres du compte</h2>
            <p>Connecté en tant que admin.</p>
            <button className="bouton-secondaire" onClick={seDeconnecter}>
              Se déconnecter
            </button>
          </section>
        ) : (
          <section className="section-tickets">
            <div className="section-entete">
              <div>
                <h2>
                  {pageActive === "dashboard"
                    ? "Tickets récents"
                    : pageActive === "mine"
                      ? "Tickets de admin"
                      : "Liste des tickets"}
                </h2>
                <p>Consulte les demandes d’assistance.</p>
              </div>

              <button
                className="bouton-secondaire"
                onClick={() => {
                  setPageActive("tickets");
                  setRecherche("");
                  setFiltreStatut("Tous");
                }}
              >
                Voir tous les tickets
              </button>
            </div>

            <div className="outils-tickets">
              <input
                type="search"
                placeholder="Rechercher un ticket ou un demandeur..."
                value={recherche}
                onChange={(event) => setRecherche(event.target.value)}
              />

              <select
                value={filtreStatut}
                onChange={(event) => setFiltreStatut(event.target.value)}
              >
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
                    <th>DEMANDEUR</th>
                    <th>CATÉGORIE</th>
                    <th>PRIORITÉ</th>
                    <th>STATUT</th>
                    <th>DÉTAILS</th>
                  </tr>
                </thead>

                <tbody>
                  {chargement ? (
                    <tr>
                      <td colSpan="7" className="aucun-resultat">
                        Chargement des tickets...
                      </td>
                    </tr>
                  ) : (
                    ticketsFiltres.map((ticket) => (
                      <tr key={ticket.id}>
                        <td className="numero-ticket">{ticket.id}</td>
                        <td className="titre-ticket">{ticket.titre}</td>
                        <td>{ticket.demandeur}</td>
                        <td>{ticket.categorie}</td>
                        <td>
                          <span
                            className={`priorite ${ticket.priorite.toLowerCase()}`}
                          >
                            {ticket.priorite}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`statut ${ticket.statut
                              .toLowerCase()
                              .replace(" ", "-")}`}
                          >
                            {ticket.statut}
                          </span>
                        </td>
                        <td>
                          <button
                            className="bouton-details"
                            onClick={() => {
                              setTicketSelectionne(ticket);
                              setNouveauStatut(ticket.statut);
                              setErreurApi("");
                            }}
                          >
                            Détails
                          </button>
                        </td>
                      </tr>
                    ))
                  )}

                  {!chargement && ticketsFiltres.length === 0 && (
                    <tr>
                      <td colSpan="7" className="aucun-resultat">
                        Aucun ticket à afficher.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      {ticketSelectionne && (
        <div
          className="modal-fond"
          onClick={() => setTicketSelectionne(null)}
        >
          <section
            className="modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-entete">
              <div>
                <h2>Détails du ticket</h2>
                <p>{ticketSelectionne.id}</p>
              </div>

              <button
                className="fermer-modal"
                onClick={() => setTicketSelectionne(null)}
                aria-label="Fermer"
              >
                ×
              </button>
            </div>

            <div className="details-ticket">
              <p>
                <strong>Sujet :</strong> {ticketSelectionne.titre}
              </p>
              <p>
                <strong>Demandeur :</strong> {ticketSelectionne.demandeur}
              </p>
              <p>
                <strong>Catégorie :</strong> {ticketSelectionne.categorie}
              </p>
              <p>
                <strong>Priorité :</strong> {ticketSelectionne.priorite}
              </p>
              <p>
                <strong>Statut actuel :</strong> {ticketSelectionne.statut}
              </p>
            </div>

            <label>
              Modifier le statut
              <select
                value={nouveauStatut}
                onChange={(event) => setNouveauStatut(event.target.value)}
              >
                <option value="Ouvert">Ouvert</option>
                <option value="En cours">En cours</option>
                <option value="Résolu">Résolu</option>
              </select>
            </label>

            <div className="modal-actions">
              <button
                className="bouton-secondaire"
                onClick={() => setTicketSelectionne(null)}
              >
                Fermer
              </button>

              <button
                className="bouton-principal"
                onClick={mettreAJourStatut}
              >
                Enregistrer le statut
              </button>
              <button
                className="bouton-secondaire"
                onClick={supprimerTicket}
              >
                Supprimer
              </button>
            </div>
          </section>
        </div>
      )}

      {formulaireOuvert && (
        <div
          className="modal-fond"
          onClick={() => setFormulaireOuvert(false)}
        >
          <section
            className="modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-entete">
              <div>
                <h2>Créer un ticket</h2>
                <p>Remplis les informations de la demande.</p>
              </div>

              <button
                className="fermer-modal"
                onClick={() => setFormulaireOuvert(false)}
                aria-label="Fermer"
              >
                ×
              </button>
            </div>

            <form onSubmit={creerTicket}>
              {erreurApi && <p className="login-error">{erreurApi}</p>}

              <label>
                Sujet du ticket
                <input
                  name="titre"
                  value={nouveauTicket.titre}
                  onChange={modifierChampTicket}
                  placeholder="Ex. Problème de connexion"
                  required
                />
              </label>

              <label>
                Nom du demandeur
                <input
                  name="demandeur"
                  value={nouveauTicket.demandeur}
                  onChange={modifierChampTicket}
                  placeholder="Ex. Alex Martin"
                  required
                />
              </label>

              <label>
                Catégorie
                <select
                  name="categorie"
                  value={nouveauTicket.categorie}
                  onChange={modifierChampTicket}
                >
                  <option>Compte</option>
                  <option>Logiciel</option>
                  <option>Matériel</option>
                  <option>Réseau</option>
                </select>
              </label>

              <label>
                Priorité
                <select
                  name="priorite"
                  value={nouveauTicket.priorite}
                  onChange={modifierChampTicket}
                >
                  <option>Basse</option>
                  <option>Normale</option>
                  <option>Haute</option>
                </select>
              </label>

              <div className="modal-actions">
                <button
                  type="button"
                  className="bouton-secondaire"
                  onClick={() => setFormulaireOuvert(false)}
                >
                  Annuler
                </button>

                <button type="submit" className="bouton-principal">
                  Créer le ticket
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;