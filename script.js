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

// Event listeners
document.getElementById('currentBtn').addEventListener('click', () => {
    currentMode = 'current';
    document.getElementById('currentBtn').classList.add('active');
    document.getElementById('customBtn').classList.remove('active');
    document.getElementById('dateInputContainer').style.display = 'none';
    getMoonPhase();
});

document.getElementById('customBtn').addEventListener('click', () => {
    currentMode = 'custom';
    document.getElementById('customBtn').classList.add('active');
    document.getElementById('currentBtn').classList.remove('active');
    document.getElementById('dateInputContainer').style.display = 'block';

    // Set today's date as default
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('dateInput').value = today;
});


document.getElementById('dateInput').addEventListener('change', () => {
    const selectedDate = document.getElementById('dateInput').value;
    if (selectedDate) {
        getMoonPhase(selectedDate);
    }
});

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
    createStars();
    getMoonPhase();
});