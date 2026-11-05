// Les images ont le côté éclairé à gauche (lune décroissante vue de l'hémisphère nord) :
// on les retourne pour les phases croissantes, éclairées à droite.
const phaseTranslation = {
    'NEW_MOON': { fr: 'Nouvelle Lune', img: 'images/new.svg', flip: false },
    'WAXING_CRESCENT': { fr: 'Premier Croissant', img: 'images/waxing-crescent.svg', flip: true },
    'FIRST_QUARTER': { fr: 'Premier Quartier', img: 'images/first-quarter.svg', flip: true },
    'WAXING_GIBBOUS': { fr: 'Gibbeuse Croissante', img: 'images/waxing-gibbous.svg', flip: true },
    'FULL_MOON': { fr: 'Pleine Lune', img: 'images/full.svg', flip: false },
    'WANING_GIBBOUS': { fr: 'Gibbeuse Décroissante', img: 'images/waxing-gibbous.svg', flip: false },
    'LAST_QUARTER': { fr: 'Dernier Quartier', img: 'images/first-quarter.svg', flip: false },
    'WANING_CRESCENT': { fr: 'Dernier Croissant', img: 'images/waxing-crescent.svg', flip: false }
};

// Durée moyenne d'un cycle lunaire (d'une nouvelle lune à la suivante), en jours.
const SYNODIC_MONTH_DAYS = 29.530588853;
// Les 4 phases principales couvrent environ un jour de part et d'autre de leur valeur exacte.
const MAIN_PHASE_HALF_WINDOW = 1 / SYNODIC_MONTH_DAYS;

const BROWSER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const PHOTON_API_URL = 'https://photon.komoot.io/api/';

let currentMode = 'current';
let currentLat = null;
let currentLon = null;
let map = null;
let searchTimeout = null;

// Éléments DOM
const currentBtn = document.getElementById('currentBtn');
const customBtn = document.getElementById('customBtn');
const dateInput = document.getElementById('dateInput');
const toggleLocationBtn = document.getElementById('toggleLocationBtn');
const locationOptions = document.getElementById('locationOptions');
const currentLocationBtn = document.getElementById('currentLocationBtn');
const addressBtn = document.getElementById('addressBtn');
const mapBtn = document.getElementById('mapBtn');
const addressInput = document.getElementById('addressInput');
const addressField = document.getElementById('addressField');
const searchAddressBtn = document.getElementById('searchAddressBtn');
const mapContainer = document.getElementById('mapContainer');
const currentLocationDiv = document.getElementById('currentLocation');
const addressSuggestions = document.getElementById('addressSuggestions');

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

function formatDate(dateString) {
    // 'AAAA-MM-JJ' est lu comme minuit UTC : on formate en UTC pour ne pas afficher la veille.
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC'
    });
}

function formatTime(date, timeZone) {
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone });
}

function formatUtcOffset(minutes) {
    const sign = minutes < 0 ? '-' : '+';
    const hours = Math.floor(Math.abs(minutes) / 60);
    const rest = Math.abs(minutes) % 60;
    return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`;
}

// Longitude ramenée dans [-180, 180[ (la carte Leaflet peut en donner une au-delà).
function normalizeLongitude(lon) {
    return ((lon + 180) % 360 + 360) % 360 - 180;
}

// Fuseau horaire IANA du lieu (ex. 'Europe/Paris'), ou null s'il est impossible à déterminer.
function getLocationTimeZone(lat, lon) {
    if (typeof tzlookup !== 'function') return null;
    try {
        const timeZone = tzlookup(lat, lon);
        new Intl.DateTimeFormat('fr-FR', { timeZone }); // lève une erreur si le navigateur ne le connaît pas
        return timeZone;
    } catch (error) {
        console.warn('Fuseau horaire du lieu introuvable:', error);
        return null;
    }
}

// Date et heure affichées par une horloge du fuseau donné, à l'instant `date`.
function getZonedParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).formatToParts(date);
    const values = {};
    parts.forEach(({ type, value }) => { values[type] = Number(value); });
    return values;
}

// Décalage du fuseau par rapport à UTC à l'instant `date`, en minutes (ex. 120 pour Paris en été).
function getUtcOffsetMinutes(date, timeZone) {
    const p = getZonedParts(date, timeZone);
    const asUtc = new Date(0);
    asUtc.setUTCFullYear(p.year, p.month - 1, p.day);
    asUtc.setUTCHours(p.hour, p.minute, p.second);
    return Math.round((asUtc.getTime() - date.getTime()) / 60000);
}

// Instant correspondant à midi, heure du fuseau, pour le jour 'AAAA-MM-JJ'.
function noonInTimeZone(dateString, timeZone) {
    const noonUtc = new Date(`${dateString}T12:00:00Z`);
    if (Number.isNaN(noonUtc.getTime())) throw new Error('date invalide');
    return new Date(noonUtc.getTime() - getUtcOffsetMinutes(noonUtc, timeZone) * 60000);
}

function toIsoDateInTimeZone(date, timeZone) {
    const p = getZonedParts(date, timeZone);
    return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// Convertit la phase SunCalc (0 = nouvelle lune, 0,25 = premier quartier, 0,5 = pleine lune,
// 0,75 = dernier quartier) en clé de phaseTranslation.
function getPhaseKey(phase) {
    const w = MAIN_PHASE_HALF_WINDOW;
    if (phase < w || phase >= 1 - w) return 'NEW_MOON';
    if (phase < 0.25 - w) return 'WAXING_CRESCENT';
    if (phase < 0.25 + w) return 'FIRST_QUARTER';
    if (phase < 0.5 - w) return 'WAXING_GIBBOUS';
    if (phase < 0.5 + w) return 'FULL_MOON';
    if (phase < 0.75 - w) return 'WANING_GIBBOUS';
    if (phase < 0.75 + w) return 'LAST_QUARTER';
    return 'WANING_CRESCENT';
}

// Heure HH:MM d'un événement, ou texte explicatif quand il n'a pas lieu ce jour-là.
function formatEventTime(date, times, timeZone, alwaysUpText, alwaysDownText) {
    if (date) return formatTime(date, timeZone);
    if (times.alwaysUp) return `Aucun (${alwaysUpText})`;
    if (times.alwaysDown) return `Aucun (${alwaysDownText})`;
    return 'Aucun ce jour';
}

// Calcule localement les données affichées. `dateString` ('AAAA-MM-JJ') vaut null pour maintenant.
function computeMoonData(dateString) {
    if (typeof SunCalc === 'undefined') {
        throw new Error('la bibliothèque de calcul SunCalc n\'a pas pu être chargée.');
    }

    const hasLocation = currentLat !== null && currentLon !== null;
    const lon = hasLocation ? normalizeLongitude(currentLon) : null;
    const locationTimeZone = hasLocation ? getLocationTimeZone(currentLat, lon) : null;
    const timeZone = locationTimeZone || BROWSER_TIME_ZONE;

    const date = dateString ? noonInTimeZone(dateString, timeZone) : new Date();
    const illumination = SunCalc.getMoonIllumination(date);

    const data = {
        date: dateString || toIsoDateInTimeZone(date, timeZone),
        moon_phase: getPhaseKey(illumination.phase),
        moon_illumination_percentage: Math.round(illumination.fraction * 100),
        sunrise: null,
        sunset: null,
        moonrise: null,
        moonset: null,
        time_zone: null
    };

    if (hasLocation) {
        const utcOffset = getUtcOffsetMinutes(date, timeZone);
        const sun = SunCalc.getTimes(date, currentLat, lon, 0, utcOffset);
        const moon = SunCalc.getMoonTimes(date, currentLat, lon, utcOffset);

        data.sunrise = formatEventTime(sun.sunrise, sun, timeZone, 'jour polaire', 'nuit polaire');
        data.sunset = formatEventTime(sun.sunset, sun, timeZone, 'jour polaire', 'nuit polaire');
        data.moonrise = formatEventTime(moon.rise, moon, timeZone, 'lune toujours levée', 'lune sous l\'horizon');
        data.moonset = formatEventTime(moon.set, moon, timeZone, 'lune toujours levée', 'lune sous l\'horizon');
        data.time_zone = locationTimeZone
            ? `Heures locales du lieu : ${timeZone} (${formatUtcOffset(utcOffset)})`
            : `Heures dans le fuseau de votre navigateur : ${timeZone} (${formatUtcOffset(utcOffset)})`;
    }

    return data;
}

function updateMoonData(data) {
    const moonImage = document.getElementById('moonImage');
    const phaseName = document.getElementById('phaseName');
    const illuminationPercent = document.getElementById('illuminationPercent');
    const sunriseTime = document.getElementById('sunriseTime');
    const sunsetTime = document.getElementById('sunsetTime');
    const moonriseTime = document.getElementById('moonriseTime');
    const moonsetTime = document.getElementById('moonsetTime');
    const sunTimes = document.getElementById('sunTimes');
    const moonTimes = document.getElementById('moonTimes');
    const timesNote = document.getElementById('timesNote');
    const dateDisplay = document.getElementById('dateDisplay');

    const { fr: translatedName, img: imagePath, flip } = phaseTranslation[data.moon_phase];

    moonImage.style.opacity = 0;
    setTimeout(() => {
        moonImage.src = imagePath;
        moonImage.classList.toggle('flipped', flip);
        moonImage.style.opacity = 1;
    }, 300);

    phaseName.textContent = translatedName;
    illuminationPercent.textContent = `Luminosité de la lune: ${Math.abs(Number(data.moon_illumination_percentage))}%`;

    // Sans lieu connu, les heures de lever et coucher sont remplacées par une invitation.
    const hasTimes = data.sunrise !== null;
    sunTimes.style.display = hasTimes ? '' : 'none';
    moonTimes.style.display = hasTimes ? '' : 'none';
    if (hasTimes) {
        sunriseTime.textContent = data.sunrise;
        sunsetTime.textContent = data.sunset;
        moonriseTime.textContent = data.moonrise;
        moonsetTime.textContent = data.moonset;
        timesNote.textContent = data.time_zone;
    } else {
        timesNote.textContent = '📍 Choisissez un lieu pour afficher les levers et couchers du soleil et de la lune.';
    }

    if (data.date) {
        dateDisplay.textContent = formatDate(data.date);
        dateDisplay.style.display = 'block';
    } else {
        dateDisplay.style.display = 'none';
    }
}

// Calcul synchrone : la date choisie en mode "custom" ('AAAA-MM-JJ'), sinon maintenant.
function getMoonPhase(date = null) {
    document.getElementById('errorMessage').style.display = 'none';
    try {
        updateMoonData(computeMoonData(date));
    } catch (error) {
        showError(`Erreur : ${error.message}`);
        console.error('Détails:', error);
    }
}

function createStars() {
    const container = document.getElementById('constellation');
    const starCount = 200;

    for (let i = 0; i < starCount; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.left = `${Math.random() * 100}%`;
        star.style.top = `${Math.random() * 100}%`;
        star.style.animationDelay = `${Math.random() * 2}s`;
        star.style.animationDuration = `${0.5 + Math.random() * 2}s`;
        container.appendChild(star);
    }
}

async function searchAddressSuggestions(query) {
    if (query.length < 3) {
        addressSuggestions.style.display = 'none';
        return;
    }

    try {
        const places = await searchPlaces(query, 5);
        // Ignore une réponse arrivée après une saisie plus récente.
        if (addressField.value.trim() !== query) return;

        if (places.length > 0) {
            displaySuggestions(places);
        } else {
            addressSuggestions.style.display = 'none';
        }
    } catch (error) {
        console.error('Erreur lors de la recherche de suggestions:', error);
        addressSuggestions.style.display = 'none';
    }
}

// Géocodage avec Photon (données OpenStreetMap), qui accepte la recherche au fil de la frappe.
async function searchPlaces(query, limit) {
    const params = new URLSearchParams({ q: query, limit: String(limit), lang: 'fr' });
    const response = await fetch(`${PHOTON_API_URL}?${params}`);
    if (!response.ok) throw new Error(`Photon a répondu ${response.status}`);

    const data = await response.json();
    return (data.features || []).map(photonFeatureToPlace);
}

// Transforme un résultat Photon (GeoJSON) en { main, detail, label, lat, lon }.
function photonFeatureToPlace(feature) {
    const props = feature.properties || {};
    const [lon, lat] = feature.geometry.coordinates;
    const street = [props.housenumber, props.street].filter(Boolean).join(' ');
    const locality = [props.postcode, props.city || props.district].filter(Boolean).join(' ');
    const parts = [props.name, street, locality, props.state, props.country]
        .filter((part, index, all) => part && all.indexOf(part) === index);

    return {
        main: parts[0] || 'Lieu sans nom',
        detail: parts.slice(1).join(', '),
        label: parts.join(', ') || 'Lieu sans nom',
        lat,
        lon
    };
}

function displaySuggestions(places) {
    addressSuggestions.textContent = '';

    places.forEach(place => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';

        const main = document.createElement('div');
        main.className = 'suggestion-main';
        main.textContent = place.main;

        const detail = document.createElement('div');
        detail.className = 'suggestion-detail';
        detail.textContent = place.detail;

        item.append(main, detail);
        item.addEventListener('click', () => {
            selectSuggestion(place);
        });

        addressSuggestions.appendChild(item);
    });

    addressSuggestions.style.display = 'block';
}

function selectSuggestion(place) {
    addressField.value = place.label;
    addressSuggestions.style.display = 'none';

    currentLat = place.lat;
    currentLon = place.lon;
    currentLocationDiv.textContent = `📍 ${place.label}`;
    currentLocationDiv.style.display = 'block';
    getMoonPhase(currentMode === 'custom' ? dateInput.value : null);
    locationOptions.style.display = 'none';
}

toggleLocationBtn.addEventListener('click', () => {
    const isVisible = locationOptions.style.display !== 'none';
    locationOptions.style.display = isVisible ? 'none' : 'block';
});

currentLocationBtn.addEventListener('click', () => {
    getCurrentLocation();
    hideLocationInputs();
});

addressBtn.addEventListener('click', () => {
    hideLocationInputs();
    addressInput.style.display = 'flex';
    addressField.focus();
});

mapBtn.addEventListener('click', () => {
    hideLocationInputs();
    showMap();
});

searchAddressBtn.addEventListener('click', () => {
    const address = addressField.value.trim();
    if (address) {
        geocodeAddress(address);
    }
});

addressField.addEventListener('input', (e) => {
    const query = e.target.value.trim();

    if (searchTimeout) {
        clearTimeout(searchTimeout);
    }

    searchTimeout = setTimeout(() => {
        searchAddressSuggestions(query);
    }, 300);
});

addressField.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        clearTimeout(searchTimeout);
        addressSuggestions.style.display = 'none';
        searchAddressBtn.click();
    }
});

document.addEventListener('click', (e) => {
    if (!addressInput.contains(e.target)) {
        addressSuggestions.style.display = 'none';
    }
});

function hideLocationInputs() {
    addressInput.style.display = 'none';
    mapContainer.style.display = 'none';
    addressSuggestions.style.display = 'none';
}

function getCurrentLocation() {
    currentLocationDiv.textContent = '📍 Localisation en cours...';
    currentLocationDiv.style.display = 'block';

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                currentLat = position.coords.latitude;
                currentLon = position.coords.longitude;
                currentLocationDiv.textContent = `📍 Position actuelle (${currentLat.toFixed(4)}, ${currentLon.toFixed(4)})`;
                getMoonPhase(currentMode === 'custom' ? dateInput.value : null);
                locationOptions.style.display = 'none';
            },
            (error) => {
                const reason = error.code === error.PERMISSION_DENIED
                    ? 'Accès à votre position refusé'
                    : 'Votre position n\'a pas pu être déterminée';
                const kept = currentLat !== null ? ' Le lieu précédent reste utilisé.' : '';
                currentLocationDiv.textContent = `❌ ${reason}. Choisissez une adresse ou un point sur la carte.${kept}`;
                currentLocationDiv.style.display = 'block';
                locationOptions.style.display = 'none';
                console.warn('Géolocalisation impossible:', error);
            }
        );
    } else {
        currentLocationDiv.textContent = '❌ Géolocalisation non supportée';
    }
}

function showMap() {
    mapContainer.style.display = 'block';

    if (!map) {
        setTimeout(() => {
            map = L.map('mapContainer').setView([46.603354, 1.888334], 6);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(map);

            setTimeout(() => {
                map.invalidateSize();
            }, 100);

            map.on('click', (e) => {
                currentLat = e.latlng.lat;
                currentLon = e.latlng.lng;

                map.eachLayer((layer) => {
                    if (layer instanceof L.Marker) {
                        map.removeLayer(layer);
                    }
                });

                L.marker([currentLat, currentLon]).addTo(map);
                currentLocationDiv.textContent = `📍 Position sélectionnée (${currentLat.toFixed(4)}, ${currentLon.toFixed(4)})`;
                currentLocationDiv.style.display = 'block';
                getMoonPhase(currentMode === 'custom' ? dateInput.value : null);
                locationOptions.style.display = 'none';
            });
        }, 300);
    } else {
        setTimeout(() => {
            map.invalidateSize();
            setTimeout(() => {
                map.invalidateSize();
            }, 100);
        }, 100);
    }
}

function geocodeAddress(address) {
    currentLocationDiv.textContent = '🔍 Recherche de l\'adresse...';
    currentLocationDiv.style.display = 'block';

    searchPlaces(address, 1)
        .then(places => {
            if (places.length > 0) {
                currentLat = places[0].lat;
                currentLon = places[0].lon;
                currentLocationDiv.textContent = `📍 ${places[0].label}`;
                getMoonPhase(currentMode === 'custom' ? dateInput.value : null);
                locationOptions.style.display = 'none';
            } else {
                currentLocationDiv.textContent = '❌ Adresse non trouvée';
            }
        })
        .catch(error => {
            currentLocationDiv.textContent = '❌ Erreur lors de la recherche';
            console.error('Erreur de géocodage:', error);
        });
}

currentBtn.addEventListener('click', () => {
    currentMode = 'current';
    currentBtn.classList.add('active');
    customBtn.classList.remove('active');
    document.getElementById('dateInputContainer').style.display = 'none';
    getMoonPhase();
});

customBtn.addEventListener('click', () => {
    currentMode = 'custom';
    customBtn.classList.add('active');
    currentBtn.classList.remove('active');
    document.getElementById('dateInputContainer').style.display = 'block';

    const today = new Date().toISOString().split('T')[0];
    dateInput.value = today;
});

dateInput.addEventListener('change', () => {
    const selectedDate = dateInput.value;
    if (selectedDate) {
        getMoonPhase(selectedDate);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    createStars();
    getMoonPhase();
});