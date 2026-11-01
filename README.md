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
| Assistant IA | proposition d'objets / prix, appliquée après confirmation |
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
- Les deux proxys appliquent la même limite (12 requêtes/minute par IP) et la
  même validation des entrées ; ils ne relaient jamais le corps d'erreur de Groq.
- `.gitignore` — exclut la clé API et les artefacts Python

## Notes

- Les données restent dans le navigateur : penser à l'export JSON (onglet
  **Données**) avant de vider le cache ou de changer de machine.
- Le serveur n'est pas destiné à une exposition publique telle quelle : il sert
  à un usage local / un aperçu.
