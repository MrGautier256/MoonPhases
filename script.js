const API_KEY = 'REMOVED_API_KEY';
const phaseTranslation = {
    'NEW_MOON': { fr: 'Nouvelle Lune', img: 'images/new.svg', flip: false },
    'WAXING_CRESCENT': { fr: 'Premier Croissant', img: 'images/waxing-crescent.svg', flip: false },
    'FIRST_QUARTER': { fr: 'Premier Quartier', img: 'images/first-quarter.svg', flip: false },
    'WAXING_GIBBOUS': { fr: 'Gibbeuse Croissante', img: 'images/waxing-gibbous.svg', flip: false },
    'FULL_MOON': { fr: 'Pleine Lune', img: 'images/full.svg', flip: false },
    'WANING_GIBBOUS': { fr: 'Gibbeuse Décroissante', img: 'images/waxing-gibbous.svg', flip: true },
    'LAST_QUARTER': { fr: 'Dernier Quartier', img: 'images/first-quarter.svg', flip: true },
    'WANING_CRESCENT': { fr: 'Dernier Croissant', img: 'images/waxing-crescent.svg', flip: true }
};

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

function showLoader(show) {
    document.getElementById('loader').style.display = show ? 'block' : 'none';
}

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function updateMoonData(data) {
    const moonImage = document.getElementById('moonImage');
    const phaseName = document.getElementById('phaseName');
    const illuminationPercent = document.getElementById('illuminationPercent');
    const sunriseTime = document.getElementById('sunriseTime');
    const sunsetTime = document.getElementById('sunsetTime');
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
    sunriseTime.textContent = data.sunrise;
    sunsetTime.textContent = data.sunset;

    if (data.date) {
        dateDisplay.textContent = formatDate(data.date);
        dateDisplay.style.display = 'block';
    } else {
        dateDisplay.style.display = 'none';
    }
}

async function getMoonPhase(date = null) {
    try {
        showLoader(true);
        document.getElementById('errorMessage').style.display = 'none';

        let url = `https://api.ipgeolocation.io/astronomy?apiKey=${API_KEY}`;

        if (currentLat && currentLon) {
            url += `&lat=${currentLat}&long=${currentLon}`;
        }

        if (date) {
            url += `&date=${date}`;
        }

        const response = await fetch(url);
        if (!response.ok) throw new Error('Erreur de réseau');

        const data = await response.json();
        if (!phaseTranslation[data.moon_phase]) throw new Error('Phase non reconnue');

        updateMoonData(data);
    } catch (error) {
        showError(`Erreur : ${error.message}`);
        console.error('Détails:', error);
    } finally {
        showLoader(false);
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
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`);
        const data = await response.json();

        if (data && data.length > 0) {
            displaySuggestions(data);
        } else {
            addressSuggestions.style.display = 'none';
        }
    } catch (error) {
        console.error('Erreur lors de la recherche de suggestions:', error);
        addressSuggestions.style.display = 'none';
    }
}

function displaySuggestions(suggestions) {
    addressSuggestions.innerHTML = '';

    suggestions.forEach(suggestion => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';

        const mainText = suggestion.display_name.split(',')[0];
        const detailText = suggestion.display_name.split(',').slice(1, 3).join(',');

        item.innerHTML = `
                    <div class="suggestion-main">${mainText}</div>
                    <div class="suggestion-detail">${detailText}</div>
                `;

        item.addEventListener('click', () => {
            selectSuggestion(suggestion);
        });

        addressSuggestions.appendChild(item);
    });

    addressSuggestions.style.display = 'block';
}

function selectSuggestion(suggestion) {
    addressField.value = suggestion.display_name;
    addressSuggestions.style.display = 'none';

    currentLat = parseFloat(suggestion.lat);
    currentLon = parseFloat(suggestion.lon);
    currentLocationDiv.textContent = `📍 ${suggestion.display_name}`;
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
                currentLocationDiv.textContent = '📍 Utilisation de votre position IP';
                currentLocationDiv.style.display = 'block';
                getMoonPhase(currentMode === 'custom' ? dateInput.value : null);
                locationOptions.style.display = 'none';
                console.log('Géolocalisation refusée, utilisation de la position IP:', error);
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

    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`)
        .then(response => response.json())
        .then(data => {
            if (data && data.length > 0) {
                currentLat = parseFloat(data[0].lat);
                currentLon = parseFloat(data[0].lon);
                currentLocationDiv.textContent = `📍 ${data[0].display_name}`;
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