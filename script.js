const API_KEY = 'REMOVED_API_KEY ';
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

function showLoader(show) {
    document.getElementById('loader').style.display = show ? 'block' : 'none';
}

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

function updateMoonData(data) {
    const moonImage = document.getElementById('moonImage');
    const phaseName = document.getElementById('phaseName');
    const illuminationPercent = document.getElementById('illuminationPercent');
    const { fr: translatedName, img: imagePath, flip } = phaseTranslation[data.moon_phase];

    // Mise à jour de l'image et du nom
    moonImage.style.opacity = 0;
    setTimeout(() => {
        moonImage.src = imagePath;
        moonImage.classList.toggle('flipped', flip);
        moonImage.style.opacity = 1;
    }, 300);

    // Mise à jour des textes
    phaseName.textContent = translatedName;
    illuminationPercent.textContent = `Luminosité : ${data.moon_illumination_percentage}%`;
}

async function getMoonPhase() {
    try {
        showLoader(true);
        document.getElementById('errorMessage').style.display = 'none';

        const response = await fetch(`https://api.ipgeolocation.io/astronomy?apiKey=${API_KEY}`);
        if (!response.ok) throw new Error('Erreur de réseau');

        const data = await response.json();
        if (!phaseTranslation[data.moon_phase]) throw new Error('Phase non reconnue');

        updateMoonData(data); // Appel modifié
    } catch (error) {
        showError(`Erreur : ${error.message}`);
        console.error('Détails:', error);
    } finally {
        showLoader(false);
    }
}

// Génération des étoiles
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

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
    createStars();
    getMoonPhase();
});