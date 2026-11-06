# LLM Dashboard

Dashboard web léger (HTML + JS, zéro dépendance) pour surveiller l'état des modèles
llama-swap / llama-cpp sur une machine du réseau, destiné à être hébergé sur un NAS.

## Fonctionnalités

  - **Hardware** : VRAM, RAM système, modèle de GPU, utilisation GPU — charge *live*
- **Débit** : tokens/s en génération et en prompt, avec courbe des 60 dernières secondes
- **Modèles** : statut (chargé / démarrage / inactif / arrêté), boutons Réveiller / Décharger
- **File d'attente** : modèles en cours de démarrage
- **Requêtes récentes** : modèle, statut, tokens in/out, latence, débit

## Utilisation

Le dashboard lit `config.json` au démarrage (hôte, clé API, intervalle en ms), puis
`localStorage` pour les dépassements utilisateur. Modifier directement `config.json`
suffit pour configurer l'hôte et la clé ; l'interface permet aussi de tout saisir
manuellement puis **Connexion**.

`config.json` :

```json
{ "host": "http://nas:8080", "apiKey": "", "pollMs": 3000 }
```

## API llama-swap consultées

| Panneau | Endpoint |
|---------|----------|
| Hardware | `GET /metrics` (Prometheus, charge live) |
| État modèles | `GET /running` |
| Débit / requêtes | `GET /api/metrics/activity?limit=50` |
| Liste modèles (live) | `GET /api/events` (SSE) |
| Version | `GET /api/version` |
| Réveiller | `POST /v1/chat/completions` (première requ déclenche le swap) |
| Décharger | `POST /api/models/unload/{model}` |

> `llama-swap` n'a pas d'endpoint de chargement dédié : un modèle se réveille à la

> Si le llama-swap exige une clé API (champ « clé API »), envoyez-la dans l'en-tête
> `x-api-key`. Elle est mémorisée en `localStorage` et transmise sur toutes les requêtes.
> La liste des modèles en live passe par un reader `fetch` (et non `EventSource`) car
> `EventSource` ne peut pas envoyer d'en-tête.

## Test avec le mock

Le fichier `mock-llama.js` sert une fausse API llama-swap pour tester le dashboard
sans machine réelle :

```sh
node mock-llama.js index.html
# puis ouvrir http://localhost:8123/ et entrer http://localhost:8123 dans le champ
```

## Dépendances

Aucune. HTML/CSS/JS vanilla, compatible navigateurs récents.
