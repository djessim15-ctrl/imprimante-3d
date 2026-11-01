# PrintProfit — Gestion & vente d'impressions 3D

Application web pour piloter un atelier d'impression 3D : coûts de revient réels,
catalogue d'objets, boutique, ventes et rentabilité. Interface en français,
100 % côté navigateur (données en `localStorage`), plus un assistant IA optionnel.

## En ligne

Production : **https://printprofit-eight.vercel.app**

## Lancer en local

```bash
python3 server.py            # http://localhost:3000  (variable PORT pour changer)
```

Aucune dépendance à installer (bibliothèque standard uniquement).

## Déploiement

Deux implémentations du même `/api/chat`, selon l'environnement :

| | Fichier | Runtime |
|---|---|---|
| Local | `server.py` (serveur statique + proxy) | Python, stdlib |
| Vercel | `api/chat.mjs` (fonction serverless) | Node |

- `index.html` est servi tel quel (statique), en local par `server.py`, en
  production par Vercel.
- Sur Vercel, la clé vient de la variable d'environnement `GROQ_API_KEY`
  (Project Settings → Environment Variables), pas d'un fichier.
- `main` est la branche de production Vercel ; `server.py` reste inutilisé
  en ligne.

## Assistant IA (optionnel)

L'onglet **Assistant IA** passe par `/api/chat`, qui relaie vers l'API Groq
(modèle `openai/gpt-oss-120b`, réponse JSON). Il faut une clé Groq, fournie de
l'une de ces façons :

- variable d'environnement : `GROQ_API_KEY=... python3 server.py`
- fichier `.groq_key` à la racine (ignoré par Git)

Sans clé, le reste de l'application fonctionne normalement.

## Fonctionnalités

| Onglet | Contenu |
|---|---|
| Assistant IA | agent multi-actions, contexte de l'écran, diagnostic live, confirmation ligne par ligne, annulation |
| Tableau de bord | KPI, stock bas, ventes récentes, graphiques |
| Simulateur | coût matière + énergie + usure machine + main-d'œuvre, prix conseillé |
| Filaments | bobines, prix au gramme, stock restant |
| Objets & prix | catalogue avec marge, temps d'impression, poids |
| Boutique | panier et encaissement |
| Ventes | historique, statuts, bénéfice par vente |
| Rentabilité | marges par objet, répartition, évolutions |
| Réglages / Données | paramètres machine et électricité, import / export JSON |

## Fichiers

- `index.html` — l'application complète (UI + logique, un seul fichier)
- `server.py` — serveur local : statique + proxy `/api/chat`
- `api/chat.mjs` — même proxy en fonction serverless Vercel
- Les deux proxys appliquent la même validation des entrées (30 requêtes/minute
  par IP, 20 messages max) et ne relaient jamais le corps d'erreur de Groq.
- `api/chat.mjs` choisit le modèle : `openai/gpt-oss-20b` pour une question
  courte, `openai/gpt-oss-120b` dès qu'il y a une action à produire. Une réponse
  JSON tronquée est réparée côté serveur (`repairJson`) avant d'arriver au client.

## Assistant IA — ce qu'il sait faire

- **Filaments** : ajouter (une ou plusieurs bobines), modifier, supprimer.
- **Objets** : créer (le poids est facultatif, il est estimé depuis la durée),
  modifier, supprimer, réapprovisionner le stock.
- **Prix** : viser une marge nette (`goal_price` avec `marginPct`) ou un
  coefficient sur le coût (`multiplier`), sur un objet ou tout le catalogue.
- **Ventes** : enregistrer une vente (par nom d'objet, la casse et les accents
  ne comptent pas), changer un statut, supprimer.
- **Réglages** : machine, électricité, débit matière, frais de vente, TVA,
  postes de coût optionnels (`includeLabor`, `includeWear`, `includePackaging`).
- **Analyse** : totaux, marges, stock, objets sous-margés, ventes à expédier —
  il répond avec les chiffres réels de l'état transmis.
- **Garde-fous** : les ids sont vérifiés, une suppression exige une seconde
  confirmation, une ligne de la proposition peut être retirée avant validation,
  et l'action confirmée reste annulable (dis « annule »).

Tests hors ligne (aucun appel réseau, aucune clé requise) :

```bash
node .arena/test_agent.js && node .arena/test_agent2.js && node .arena/test_confirm.js
node .arena/test_chat.js && node .arena/test_poids.js && node .arena/test_couts.js
node .arena/test_api.mjs
```
- `.gitignore` — exclut la clé API et les artefacts Python

## Notes

- Les données restent dans le navigateur : penser à l'export JSON (onglet
  **Données**) avant de vider le cache ou de changer de machine.
- Le serveur n'est pas destiné à une exposition publique telle quelle : il sert
  à un usage local / un aperçu.
