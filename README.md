# MoonPhases

Petit site statique (HTML, CSS, JavaScript, sans étape de build) qui affiche la phase de la lune et son illumination pour aujourd'hui ou pour une date choisie, ainsi que les heures de lever et de coucher du soleil et de la lune pour un lieu donné (position actuelle, adresse ou point sur une carte).

## Calculs locaux, sans clé d'API

Toutes les données astronomiques sont calculées directement dans le navigateur, sans appel à une API et sans clé :

- [SunCalc](https://github.com/mourner/suncalc) (v2.1.2) pour la phase, l'illumination et les heures de lever et de coucher ;
- [@photostructure/tz-lookup](https://github.com/photostructure/tz-lookup) (v11.7.0) pour déterminer le fuseau horaire du lieu, afin d'afficher les heures à l'heure locale de ce lieu.

Ces deux bibliothèques sont chargées depuis jsDelivr avec une version figée et une empreinte d'intégrité (SRI).

Services externes restants, tous gratuits et sans clé :

- [Photon](https://photon.komoot.io) pour la recherche d'adresse et les suggestions ;
- les tuiles [OpenStreetMap](https://www.openstreetmap.org/copyright) pour la carte (Leaflet).

Données cartographiques et d'adresses © les contributeurs OpenStreetMap.

## Lancer en local

```bash
python -m http.server
```

Puis ouvrir http://localhost:8000.
