[LISEZMOI.md](https://github.com/user-attachments/files/35332601/LISEZMOI.md)
# L'Atelier de Plume — version en ligne (Netlify)

Un atelier d'écriture pour les enfants. Plume lit le texte sans jamais le changer : il propose des mots, repère les fautes et encourage.

Dans cette version, **les comptes et les histoires sont gardés sur les serveurs de Netlify** (Netlify Blobs). Un enfant retrouve donc ses histoires sur n'importe quel ordinateur ou tablette, en se connectant avec son prénom et son mot de passe.

## Ce qu'il y a dans le dossier

```
public/index.html            le site (tout est dedans : Plume, dictionnaire, conjugaison…)
netlify/functions/api.mjs    le petit serveur : comptes, connexion, sauvegarde des histoires
netlify.toml                 la configuration Netlify
package.json                 la seule dépendance : @netlify/blobs
```

## Mettre le site en ligne

Le site a besoin que Netlify installe une petite bibliothèque pour le serveur. **Le simple glisser-déposer d'un dossier (Netlify Drop) ne suffit donc pas.** Utilise l'une de ces deux méthodes.

### Méthode 1 : avec GitHub (la plus simple)

1. Crée un compte gratuit sur github.com, puis un nouveau dépôt (par exemple `atelier-de-plume`).
2. Sur la page du dépôt, choisis « Add file → Upload files » et dépose **le contenu** du dossier : `public`, `netlify`, `netlify.toml`, `package.json` et `.gitignore`.
3. Sur netlify.com, ajoute un nouveau projet en l'important depuis GitHub, puis choisis ton dépôt.
4. Netlify lit `netlify.toml` tout seul : il n'y a rien à régler. Lance le déploiement.

À chaque modification envoyée sur GitHub, Netlify remet le site à jour automatiquement.

### Méthode 2 : avec l'outil en ligne de commande

Dans le dossier, avec Node.js installé :

```
npm install
npx netlify-cli login
npx netlify-cli deploy --prod
```

## Le code adulte (mot de passe oublié)

Si un enfant oublie son mot de passe, un adulte peut en choisir un nouveau grâce à un **code adulte**. Sans ce code, personne ne peut changer le mot de passe d'un autre.

1. Dans Netlify, ouvre les réglages du site, puis les variables d'environnement.
2. Ajoute une variable nommée `ADMIN_CODE`. Mets comme valeur un code que toi seul connais, par exemple une phrase longue.
3. Redéploie le site pour que le code soit pris en compte.

## Récupérer les histoires de l'ancienne version

Les histoires écrites dans l'ancienne version restent dans l'ancien navigateur. Pour les transférer :

1. Dans l'ancienne version, utilise « Enregistrer ma bibliothèque » pour obtenir un fichier `.atelier`.
2. Dans la nouvelle version, connecte-toi, puis ouvre ce fichier avec « Ouvrir ».

## Sécurité et vie privée

- Les mots de passe ne sont jamais gardés tels quels : le serveur n'en garde qu'une empreinte (scrypt).
- Une connexion dure le temps de la session du navigateur. Après 5 erreurs de mot de passe, il faut attendre 30 secondes.
- La page d'accueil n'affiche que les prénoms déjà utilisés **sur cet appareil**, jamais la liste de tous les comptes.
- Sans internet, le site continue de marcher. Les modifications sont gardées dans le navigateur, puis envoyées au retour de la connexion. Le bouton du compte affiche « hors ligne » pendant ce temps.
- Les données d'enfants sont des données personnelles. Si le site est ouvert à d'autres familles ou à une classe, informe les parents et demande leur accord (RGPD).

## Limites

- Les prénoms sont uniques sur tout le site. Si « Lina » est déjà pris, on peut écrire « Lina B. ».
- Une sauvegarde ne peut pas dépasser 6 Mo d'un coup, à cause des images de couverture. Si le site affiche « Ton espace est plein », il suffit de retirer quelques couvertures.
- Si le même compte est ouvert sur deux appareils en même temps, c'est la dernière modification qui gagne. L'autre appareil se met à jour quand on revient sur son onglet.
