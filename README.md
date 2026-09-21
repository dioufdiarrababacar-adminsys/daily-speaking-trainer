# Daily Speaking Trainer

> Ton coach-avatar en appel vidéo : parler 1 à 5 minutes par jour en français, anglais ou espagnol, avec un chrono, des pistes, du vocabulaire et un retour du coach.

**Statut :** v0.1, application fonctionnelle, feedback IA via Gemini (tier gratuit), optionnel.
**Inputs :** maquette Claude Design dans `context/import/Daily Speaking Trainer.dc.html` (+ `Avatar.dc.html`, `support.js`).

---

## Ce que fait l'app

- **Accueil** : choix du coach (8 avatars animés, chacun avec sa voix et sa couleur d'accent), langue FR/EN/ES, niveau A1 à C2, durée 1/2/3/5 min. La langue choisie traduit toute l'interface et le feedback du coach.
- **Appel** : le coach lit le sujet à voix haute (synthèse vocale du navigateur, bouche animée), puis tu parles. Le chrono ne démarre que quand tu commences à parler. Forme d'onde en direct, réactions du coach, panneaux « Pistes » et « Vocabulaire » (mot + explication).
- **Feedback** : mesures locales (mots/min, hésitations, temps de parole réel) + corrections, points forts, tournures à réutiliser et question de relance générés par Gemini si le serveur tourne. Jusqu'à 3 tours par appel.
- **Fin d'appel** : récap, réécoute et téléchargement de l'enregistrement, sauvegarde des corrections dans le carnet, rappel pour le lendemain.
- **Progression** : série, record, minutes par semaine, calendrier du mois, répartition par langue, erreurs fréquentes, derniers appels.
- **Carnet** : toutes les corrections, filtrables par langue, avec un mode « Me tester dessus ».
- **Personnaliser** : centres d'intérêt (pilotent le choix des sujets), objectif, thème clair/sombre/système, confidentialité (envoi de la transcription ou mode 100 % local).

Tout est stocké dans le `localStorage` du navigateur. Rien ne part vers un serveur en mode local.

---

## Lancer

### Option A : avec le feedback IA (recommandé)

Prérequis : Node 20.6+ et `GEMINI_API_KEY` renseignée dans le `.env` à la racine du workspace (clé gratuite sur aistudio.google.com, sans carte bancaire).

```bash
cd livrables/applications/2026-09-daily-speaking-trainer
npm start
```

Aucune installation : zéro dépendance. Ouvre ensuite http://localhost:3000. Le serveur sert `src/` et expose `POST /api/feedback`, qui envoie la transcription à Gemini (`gemini-3.5-flash-lite` par défaut, avec `gemini-3.6-flash` puis `gemini-3.1-flash-lite` en secours si le modèle est saturé ; ordre modifiable via `DST_MODEL`, liste séparée par des virgules) et renvoie un JSON structuré (points forts, corrections taguées, tournures, relance).

Le tier gratuit de Gemini est limité en requêtes par minute et par jour : si le feedback renvoie une erreur 429, attends une minute. En cas d'échec, l'app réessaie une fois puis bascule sur les mesures locales.

### Option B : sans serveur (mode local)

Ouvre directement `src/index.html` dans Chrome ou Edge. Tout fonctionne sauf les corrections IA : l'app le signale et bascule sur les mesures locales.

---

## Compatibilité navigateur

| Fonction | Chrome / Edge | Firefox | Safari |
|----------|---------------|---------|--------|
| Micro, chrono, forme d'onde, enregistrement | oui | oui | oui |
| Voix du coach (synthèse vocale) | oui | oui | oui |
| Voix « naturelles » (neurales) | Edge : oui · Chrome : voix Google en ligne | non | oui |
| Transcription (Web Speech API) | oui | non | partiel |

Sans transcription, il n'y a ni mots/min, ni hésitations, ni corrections IA. Chrome ou Edge sont donc recommandés.

**Voix des coachs.** L'app choisit, parmi les voix installées, une voix de la langue cible et du genre du coach, en privilégiant les voix naturelles. Ce que tu entends dépend donc de ta machine : Windows n'installe par défaut que quelques voix (ici : Hortense, Julie, Paul en français, Zira en anglais, aucune en espagnol). Pour des voix plus humaines et un homme/une femme par coach :
- **Edge** utilise ses voix neurales en ligne (Denise, Henri, Aria, Guy, Elvira, Alvaro…), le meilleur rendu sans rien installer.
- Sinon, sur Windows : Paramètres → Heure et langue → Voix → « Ajouter des voix » (anglais : Mark, David ; espagnol : Helena, Pablo, Laura).

Le chrono démarre à la première détection de voix (seuil sur le niveau du micro). Dans un environnement très bruyant, il peut partir un peu tôt : parle dès que tu es prêt.

---

## Structure

```
2026-09-daily-speaking-trainer/
├── README.md
├── package.json         # scripts seulement, aucune dépendance
├── .env.example
├── server.js            # statique + POST /api/feedback → Gemini (Node, ESM, fetch natif)
└── src/
    ├── index.html
    ├── styles.css       # tokens clair/sombre, composants, layouts mobile (375) et desktop (1024+)
    ├── avatar.js        # 8 identités × 7 expressions, couches SVG animables
    ├── data.js          # 50 sujets, pistes, vocabulaire (3 langues × 3 paliers)
    ├── i18n.js          # textes de l'interface en FR / EN / ES
    └── app.js           # machine à états, audio, voix, écrans, stockage
```

Aucun build, aucun framework : HTML, CSS et JavaScript natifs.

---

## Pistes d'évolution

- Ajouter des sujets dans `data.js` (chaque entrée : langue, palier, tags, texte, 3 pistes, 5 mots, relance).
- Notifications système pour le rappel du lendemain (la permission est demandée, l'envoi n'est pas encore implémenté).
- Évaluation de la prononciation (hors périmètre de la maquette).
