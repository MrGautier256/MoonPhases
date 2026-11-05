# MoonPhases

Site statique (HTML, CSS, JavaScript, sans étape de build), pensé d'abord pour le téléphone, qui montre la Lune telle qu'elle est jour après jour :

- la Lune elle-même, dessinée ou réaliste, éclairée selon sa phase réelle, à faire défiler d'un glissement du doigt ;
- quand la voir cette nuit, avec les levers et couchers de la Lune et du Soleil là où vous êtes ;
- les prochaines phases, avec leur heure exacte, et un calendrier lunaire ;
- le dernier lieu choisi, mémorisé sur l'appareil uniquement.

## Calculs locaux, sans clé d'API

Toutes les données astronomiques sont calculées directement dans le navigateur, sans appel à une API et sans clé :

- [SunCalc](https://github.com/mourner/suncalc) (v2.1.2) pour la phase, l'illumination, les positions et les heures de lever et de coucher ;
- [@photostructure/tz-lookup](https://github.com/photostructure/tz-lookup) (v11.7.0) pour déterminer le fuseau horaire du lieu, afin d'afficher les heures à l'heure locale de ce lieu.

Ces deux bibliothèques sont chargées depuis jsDelivr avec une version figée et une empreinte d'intégrité (SRI).

Services externes restants, tous gratuits et sans clé :

- [Photon](https://photon.komoot.io) pour la recherche de lieux et le nom d'une position (coordonnées arrondies à environ 1 km) ;
- [Leaflet](https://leafletjs.com) et les tuiles [OpenStreetMap](https://www.openstreetmap.org/copyright), chargés seulement à l'ouverture de la carte.

Données cartographiques et d'adresses © les contributeurs OpenStreetMap.

## Images et polices

`moon.js` affiche la Lune en deux versions, qui suivent la même phase et la même inclinaison. La version dessinée, affichée par défaut, part du dessin vectoriel de `moon-drawing.js`, y découpe l'ombre selon la phase et déplace les ombres des cratères avec le Soleil. La version réaliste, chargée seulement à la demande, éclaire pixel par pixel deux images précalculées à partir du [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) de NASA's Scientific Visualization Studio (`lroc_color_poles_4k` et `ldem_16`), projetées sur le disque visible depuis la Terre, nord en haut : `images/moon-albedo.webp` pour la surface, `images/moon-relief.webp` pour les cratères le long de la frontière jour/nuit.

La police [Fredoka](https://fonts.google.com/specimen/Fredoka) est hébergée dans `fonts/`, sous licence SIL Open Font License.

## Lancer en local

```bash
python -m http.server
```

Puis ouvrir http://localhost:8000.
