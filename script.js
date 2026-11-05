// Phase Lunaire : toutes les données astronomiques sont calculées dans le navigateur.

const PHASE_NAMES = {
    NEW_MOON: 'Nouvelle Lune',
    WAXING_CRESCENT: 'Premier Croissant',
    FIRST_QUARTER: 'Premier Quartier',
    WAXING_GIBBOUS: 'Gibbeuse Croissante',
    FULL_MOON: 'Pleine Lune',
    WANING_GIBBOUS: 'Gibbeuse Décroissante',
    LAST_QUARTER: 'Dernier Quartier',
    WANING_CRESCENT: 'Dernier Croissant'
};

const PRINCIPAL_PHASES = [
    { value: 0, key: 'NEW_MOON' },
    { value: 0.25, key: 'FIRST_QUARTER' },
    { value: 0.5, key: 'FULL_MOON' },
    { value: 0.75, key: 'LAST_QUARTER' }
];

const DAY_MS = 86400000;
// Durée moyenne d'un cycle lunaire (d'une nouvelle lune à la suivante), en jours.
const SYNODIC_MONTH_DAYS = 29.530588853;
// Les 4 phases principales couvrent environ un jour de part et d'autre de leur valeur exacte.
const MAIN_PHASE_HALF_WINDOW = 1 / SYNODIC_MONTH_DAYS;
// Hauteur apparente du centre de l'astre quand son bord touche l'horizon, en degrés.
const RISE_ALTITUDE = -0.27;

const BROWSER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const PHOTON_URL = 'https://photon.komoot.io';
const LEAFLET = {
    script: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    scriptIntegrity: 'sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH',
    style: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    styleIntegrity: 'sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H'
};

const STORAGE_PLACE = 'moonphases.place';
const STORAGE_RECENT = 'moonphases.recent';
const MAX_RECENT_PLACES = 4;

// La bande compte STRIP_RANGE jours de chaque côté, et se recentre près de ses bords.
const STRIP_RANGE = 120;
const STRIP_MARGIN = 20;
const STRIP_COMMIT_DELAY = 120;
// Glisser la Lune de cette distance avance d'un jour.
const DRAG_PIXELS_PER_DAY = 14;

const $ = (id) => document.getElementById(id);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const state = {
    place: null,
    timeZone: BROWSER_TIME_ZONE,
    zoneFromPlace: false,
    today: null,
    day: null,
    month: null
};
const strip = { element: $('strip'), start: null, startNoon: 0, cell: 54, current: null };
const moon = MoonRenderer.create($('moon'));

let previewFrame = 0;
let commitTimer = 0;
let searchTimer = 0;
let drag = null;
let map = null;
let mapMarker = null;
let leafletLoading = null;

// Dates et fuseaux

const dateFormats = {
    weekday: new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' }),
    monthShort: new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' }),
    month: new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    long: new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
    longNoYear: new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
    dayMonth: new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' }),
    short: new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
};
const numberFormats = {
    integer: new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }),
    oneDecimal: new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
};
const zonedFormatters = new Map();
const timeFormatters = new Map();

function asDate(day) {
    return new Date(`${day}T12:00:00Z`);
}

function addDays(day, count) {
    const date = asDate(day);
    date.setUTCDate(date.getUTCDate() + count);
    return date.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
    return Math.round((asDate(to) - asDate(from)) / DAY_MS);
}

function formatDay(day, format) {
    return dateFormats[format].format(asDate(day));
}

function formatTime(date) {
    const { timeZone } = state;
    if (!timeFormatters.has(timeZone)) {
        timeFormatters.set(timeZone, new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone }));
    }
    return timeFormatters.get(timeZone).format(date);
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
    if (!zonedFormatters.has(timeZone)) {
        zonedFormatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }));
    }
    const values = {};
    zonedFormatters.get(timeZone).formatToParts(date).forEach(({ type, value }) => { values[type] = Number(value); });
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

// Instant correspondant à cette heure, dans le fuseau du lieu, pour le jour 'AAAA-MM-JJ'.
function zonedInstant(day, hour) {
    const wallClock = new Date(`${day}T${String(hour).padStart(2, '0')}:00:00Z`).getTime();
    const firstGuess = wallClock - getUtcOffsetMinutes(new Date(wallClock), state.timeZone) * 60000;
    return new Date(wallClock - getUtcOffsetMinutes(new Date(firstGuess), state.timeZone) * 60000);
}

function toLocalDay(date) {
    const p = getZonedParts(date, state.timeZone);
    return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// Aujourd'hui : maintenant. Un autre jour : midi, heure locale, pour rester dans le bon jour.
function instantFor(day) {
    return day === state.today ? new Date() : zonedInstant(day, 12);
}

// Phases

// Convertit la phase SunCalc (0 = nouvelle lune, 0,25 = premier quartier, 0,5 = pleine lune,
// 0,75 = dernier quartier) en clé de PHASE_NAMES.
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

// Instant exact d'une phase principale, à partir d'une estimation proche.
function refinePhaseInstant(target, estimate) {
    let time = estimate;
    for (let i = 0; i < 6; i++) {
        const { phase } = SunCalc.getMoonIllumination(new Date(time));
        const gap = ((target - phase + 1.5) % 1) - 0.5;
        time += gap * SYNODIC_MONTH_DAYS * DAY_MS;
    }
    return time;
}

// Les `count` prochaines phases principales après `from`.
function nextPrincipalPhases(from, count) {
    const results = [];
    let time = from.getTime();
    let phase = SunCalc.getMoonIllumination(from).phase;
    let index = Math.floor(phase * 4) + 1;
    while (results.length < count) {
        const { value, key } = PRINCIPAL_PHASES[index % 4];
        const estimate = time + ((value - phase + 1) % 1) * SYNODIC_MONTH_DAYS * DAY_MS;
        time = refinePhaseInstant(value, estimate);
        results.push({ value, key, instant: new Date(time) });
        phase = value;
        index += 1;
    }
    return results;
}

// Tracé de la partie éclairée d'une petite lune, sur un disque de rayon 1 centré en 0.
function moonPath(phase) {
    const cosine = Math.cos(2 * Math.PI * phase);
    const waxing = phase < 0.5;
    const outerSweep = waxing ? 1 : 0;
    const innerSweep = (cosine > 0) === waxing ? 0 : 1;
    return `M0-1A1 1 0 0 ${outerSweep} 0 1A${Math.abs(cosine).toFixed(3)} 1 0 0 ${innerSweep} 0-1Z`;
}

function svgElement(tag, attributes = {}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
    return element;
}

function createMiniMoon(phase) {
    const svg = svgElement('svg', { class: 'mini', viewBox: '-1 -1 2 2', 'aria-hidden': 'true' });
    svg.append(svgElement('path', { d: moonPath(phase) }));
    return svg;
}

function createIcon(name) {
    const svg = svgElement('svg', { class: 'icon', 'aria-hidden': 'true' });
    svg.append(svgElement('use', { href: `#i-${name}` }));
    return svg;
}

// Affichage de la Lune

function renderHero(instant, day) {
    const illumination = SunCalc.getMoonIllumination(instant);
    const percent = Math.round(illumination.fraction * 100);
    const key = getPhaseKey(illumination.phase);
    const distance = SunCalc.getMoonPosition(instant, 0, 0).distance;

    moon.draw(illumination);

    const stage = $('moonStage');
    const limb = illumination.angle * Math.PI / 180;
    const side = document.documentElement.hasAttribute('data-south') ? -1 : 1;
    const strength = 1 - Math.abs(2 * illumination.fraction - 1);
    stage.style.setProperty('--lit', illumination.fraction.toFixed(3));
    stage.style.setProperty('--glow-x', (-Math.sin(limb) * strength * side).toFixed(3));
    stage.style.setProperty('--glow-y', (-Math.cos(limb) * strength * side).toFixed(3));

    $('dateLabel').textContent = day === state.today
        ? `Aujourd’hui, ${formatDay(day, 'longNoYear')}`
        : formatDay(day, 'long');
    $('phaseName').textContent = PHASE_NAMES[key];
    $('illuminationValue').textContent = `${percent} %`;
    $('ageValue').textContent = `${numberFormats.oneDecimal.format(illumination.phase * SYNODIC_MONTH_DAYS)} j`;
    $('distanceValue').textContent = `${numberFormats.integer.format(Math.round(distance / 100) * 100)} km`;

    return { key, percent };
}

function renderDay() {
    const { key, percent } = renderHero(instantFor(state.day), state.day);
    const description = `${PHASE_NAMES[key]}, ${percent} % éclairée`;

    $('moon').setAttribute('aria-label', description);
    $('liveStatus').textContent = `${formatDay(state.day, 'long')}. ${description}.`;
    $('todayButton').hidden = state.day === state.today;
    $('datePicker').value = state.day;

    markStripDay(state.day);
    renderSky();
    renderNextPhases();
    state.month = `${state.day.slice(0, 7)}-01`;
    renderCalendar();
}

// Bande des jours

function createDayCell(day) {
    const date = asDate(day);
    const isFirstOfMonth = date.getUTCDate() === 1;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'day';
    button.tabIndex = -1;
    button.dataset.day = day;
    button.setAttribute('aria-label', formatDay(day, 'long'));
    button.classList.toggle('is-month', isFirstOfMonth);
    button.classList.toggle('is-today', day === state.today);

    const label = document.createElement('span');
    label.className = 'day-week';
    label.textContent = (isFirstOfMonth ? dateFormats.monthShort : dateFormats.weekday).format(date).replace('.', '');

    const number = document.createElement('span');
    number.className = 'day-number';
    number.textContent = date.getUTCDate();

    button.append(label, createMiniMoon(SunCalc.getMoonIllumination(date).phase), number);
    return button;
}

function buildStrip(centerDay) {
    strip.start = addDays(centerDay, -STRIP_RANGE);
    strip.startNoon = zonedInstant(strip.start, 12).getTime();
    strip.current = null;

    const cells = document.createDocumentFragment();
    for (let i = 0; i <= STRIP_RANGE * 2; i++) {
        cells.append(createDayCell(addDays(strip.start, i)));
    }
    strip.element.replaceChildren(cells);
    strip.cell = strip.element.firstElementChild.getBoundingClientRect().width;
    strip.element.scrollLeft = STRIP_RANGE * strip.cell;
    markStripDay(centerDay);
}

function markStripDay(day) {
    const index = daysBetween(strip.start, day);
    const cell = strip.element.children[index];
    if (!cell || cell === strip.current) return;
    if (strip.current) {
        strip.current.removeAttribute('aria-current');
        strip.current.tabIndex = -1;
    }
    cell.setAttribute('aria-current', 'date');
    cell.tabIndex = 0;
    strip.current = cell;
}

// Pendant le défilement, la Lune suit la position exacte de la bande, entre deux jours compris.
function previewStrip() {
    previewFrame = 0;
    const position = strip.element.scrollLeft / strip.cell;
    const todayIndex = daysBetween(strip.start, state.today);
    const fromToday = Math.abs(position - todayIndex);
    let time = strip.startNoon + position * DAY_MS;
    if (fromToday < 1) {
        // Aujourd'hui vaut maintenant et non midi : on y arrive sans saut.
        time += (Date.now() - (strip.startNoon + todayIndex * DAY_MS)) * (1 - fromToday);
    }
    const day = addDays(strip.start, Math.round(position));
    markStripDay(day);
    renderHero(new Date(time), day);
}

function onStripScroll() {
    if (!previewFrame) previewFrame = requestAnimationFrame(previewStrip);
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commitStrip, STRIP_COMMIT_DELAY);
}

function commitStrip() {
    if (drag && drag.active) return;
    strip.element.style.scrollSnapType = '';
    selectDay(addDays(strip.start, Math.round(strip.element.scrollLeft / strip.cell)));
}

function selectDay(day) {
    state.day = day;
    const index = daysBetween(strip.start, day);
    if (index < STRIP_MARGIN || index > STRIP_RANGE * 2 - STRIP_MARGIN) buildStrip(day);
    renderDay();
}

function goToDay(day, animate = true) {
    const index = daysBetween(strip.start, day);
    if (index < 0 || index > STRIP_RANGE * 2) {
        buildStrip(day);
        selectDay(day);
        return;
    }
    const left = index * strip.cell;
    if (Math.abs(strip.element.scrollLeft - left) < 1) {
        selectDay(day);
    } else if (animate && !reducedMotion.matches) {
        strip.element.scrollTo({ left, behavior: 'smooth' });
    } else {
        strip.element.scrollLeft = left;
        selectDay(day);
    }
}

// Depuis un panneau, on remonte voir la Lune si elle n'est plus à l'écran.
function goToDayAndShow(day) {
    goToDay(day);
    if ($('moonStage').getBoundingClientRect().bottom < 80) {
        window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
}

// Glisser la Lune horizontalement fait défiler les jours.
function onMoonPointerDown(event) {
    drag = { id: event.pointerId, x: event.clientX, left: strip.element.scrollLeft, active: false };
}

function onMoonPointerMove(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const distance = event.clientX - drag.x;
    if (!drag.active) {
        if (Math.abs(distance) < 8) return;
        drag.active = true;
        drag.x = event.clientX;
        $('moonStage').setPointerCapture(event.pointerId);
        $('moonStage').classList.add('is-dragging');
        strip.element.style.scrollSnapType = 'none';
        return;
    }
    strip.element.scrollLeft = drag.left - distance / DRAG_PIXELS_PER_DAY * strip.cell;
}

function onMoonPointerUp() {
    if (!drag) return;
    const wasActive = drag.active;
    drag = null;
    if (!wasActive) return;
    $('moonStage').classList.remove('is-dragging');
    const left = Math.round(strip.element.scrollLeft / strip.cell) * strip.cell;
    strip.element.scrollTo({ left, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commitStrip, 400);
}

// Levers et couchers

function createTime(direction, date) {
    const time = document.createElement('span');
    time.className = 'sky-time';
    time.append(createIcon(direction), date ? formatTime(date) : '–');
    return time;
}

function renderRiseSet(element, rise, set, times, alwaysUpText, alwaysDownText) {
    const noEvent = !rise && !set;
    element.classList.toggle('is-text', noEvent);
    if (noEvent) {
        element.textContent = times.alwaysUp ? alwaysUpText : times.alwaysDown ? alwaysDownText : 'Aucun ce jour';
    } else {
        element.replaceChildren(createTime('up', rise), createTime('down', set));
    }
}

// Moment où l'état change entre `outside` et `inside`, à quelques secondes près.
function refineVisibilityEdge(isVisible, outside, inside) {
    let a = outside;
    let b = inside;
    for (let i = 0; i < 7; i++) {
        const middle = (a + b) / 2;
        if (isVisible(middle)) b = middle;
        else a = middle;
    }
    return new Date(b);
}

// Quand voir la Lune dans le noir, du midi du jour choisi au midi suivant.
// Avant 6 h, la nuit dont on parle aujourd'hui est celle qui se termine.
function describeVisibility() {
    const { lat, lon } = state.place;
    const isToday = state.day === state.today;
    const isEndingNight = isToday && getZonedParts(new Date(), state.timeZone).hour < 6;
    const title = isToday ? 'Cette nuit' : `Nuit du ${formatDay(state.day, 'dayMonth')}`;
    const isDark = (time) => SunCalc.getPosition(new Date(time), lat, lon).altitude < RISE_ALTITUDE;
    const isMoonUp = (time) => SunCalc.getMoonPosition(new Date(time), lat, lon).altitude > RISE_ALTITUDE;
    const isVisible = (time) => isDark(time) && isMoonUp(time);

    const start = zonedInstant(isEndingNight ? addDays(state.day, -1) : state.day, 12).getTime();
    const step = 5 * 60000;
    let dark = 0;
    let visible = 0;
    let first = null;
    let last = null;
    for (let time = start; time <= start + DAY_MS; time += step) {
        if (!isDark(time)) continue;
        dark += 1;
        if (isMoonUp(time)) {
            visible += 1;
            if (first === null) first = time;
            last = time;
        }
    }

    if (dark === 0) return { title: 'Dans le ciel', text: 'Pas de nuit ce jour-là' };
    if (visible === 0) return { title, text: 'Sous l’horizon toute la nuit' };
    if (visible === dark) return { title, text: 'Visible du soir au matin' };
    const from = refineVisibilityEdge(isVisible, first - step, first);
    const to = refineVisibilityEdge(isVisible, last + step, last);
    return { title, text: `Visible de ${formatTime(from)} à ${formatTime(to)}` };
}

function renderSky() {
    const hasPlace = Boolean(state.place);
    $('skyEmpty').hidden = hasPlace;
    $('skyContent').hidden = !hasPlace;
    if (!hasPlace) {
        $('skyTitle').textContent = 'Dans le ciel';
        return;
    }

    const { lat, lon } = state.place;
    const instant = instantFor(state.day);
    const utcOffset = getUtcOffsetMinutes(instant, state.timeZone);
    const sun = SunCalc.getTimes(instant, lat, lon, 0, utcOffset);
    const moonTimes = SunCalc.getMoonTimes(instant, lat, lon, utcOffset);

    renderRiseSet($('sunTimes'), sun.sunrise, sun.sunset, sun, 'Jour polaire', 'Nuit polaire');
    renderRiseSet($('moonTimes'), moonTimes.rise, moonTimes.set, moonTimes, 'Toujours levée', 'Sous l’horizon');
    const visibility = describeVisibility();
    $('skyTitle').textContent = visibility.title;
    $('visibility').textContent = visibility.text;

    const zone = `${state.timeZone.replaceAll('_', ' ')} (${formatUtcOffset(utcOffset)})`;
    $('timeZoneNote').textContent = state.zoneFromPlace
        ? `Heures locales : ${zone}`
        : `Heures de votre appareil : ${zone}`;
}

// Prochaines phases

function describeDelay(days) {
    const isToday = state.day === state.today;
    if (days === 0) return isToday ? 'aujourd’hui' : 'ce jour-là';
    if (days === 1) return isToday ? 'demain' : 'le lendemain';
    return `dans ${days} j`;
}

function renderNextPhases() {
    const rows = nextPrincipalPhases(instantFor(state.day), 4).map(({ value, key, instant }) => {
        const day = toLocalDay(instant);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'phase-row';
        row.dataset.day = day;

        const text = document.createElement('span');
        text.className = 'phase-row-text';
        const name = document.createElement('span');
        name.className = 'phase-row-name';
        name.textContent = PHASE_NAMES[key];
        const date = document.createElement('span');
        date.className = 'phase-row-date';
        date.textContent = `${formatDay(day, 'short')} à ${formatTime(instant)}`;
        text.append(name, date);

        const delay = document.createElement('span');
        delay.className = 'phase-row-delay';
        delay.textContent = describeDelay(daysBetween(state.day, day));

        row.append(createMiniMoon(value), text, delay);
        const item = document.createElement('li');
        item.append(row);
        return item;
    });
    $('nextPhases').replaceChildren(...rows);
}

// Calendrier

// Jours du mois où tombe une phase principale, avec leur nom.
function principalPhasesOfMonth(firstDay, dayCount) {
    const end = zonedInstant(addDays(firstDay, dayCount), 0);
    const found = new Map();
    nextPrincipalPhases(zonedInstant(firstDay, 0), 6).forEach(({ key, instant }) => {
        if (instant < end) found.set(toLocalDay(instant), key);
    });
    return found;
}

function renderCalendar() {
    const first = asDate(state.month);
    const year = first.getUTCFullYear();
    const month = first.getUTCMonth();
    const dayCount = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const leadingDays = (first.getUTCDay() + 6) % 7;
    const principal = principalPhasesOfMonth(state.month, dayCount);

    $('monthLabel').textContent = dateFormats.month.format(first);

    const cells = [];
    for (let i = 0; i < leadingDays; i++) cells.push(document.createElement('span'));
    for (let i = 0; i < dayCount; i++) {
        const day = addDays(state.month, i);
        const key = principal.get(day);
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'calendar-day';
        cell.dataset.day = day;
        cell.classList.toggle('is-key', Boolean(key));
        cell.classList.toggle('is-today', day === state.today);
        if (day === state.day) cell.setAttribute('aria-current', 'date');
        cell.setAttribute('aria-label', key ? `${formatDay(day, 'long')}, ${PHASE_NAMES[key]}` : formatDay(day, 'long'));
        cell.append(createMiniMoon(SunCalc.getMoonIllumination(asDate(day)).phase), String(i + 1));
        cells.push(cell);
    }
    $('calendar').replaceChildren(...cells);
}

function changeMonth(step) {
    const first = asDate(state.month);
    first.setUTCDate(1);
    first.setUTCMonth(first.getUTCMonth() + step);
    state.month = first.toISOString().slice(0, 10);
    renderCalendar();
}

// Stockage local : la page reste utilisable s'il est indisponible.

function readStorage(key, fallback) {
    try {
        const value = JSON.parse(localStorage.getItem(key));
        return value === null ? fallback : value;
    } catch {
        return fallback;
    }
}

function writeStorage(key, value) {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Navigation privée ou stockage bloqué : le lieu ne sera simplement pas mémorisé.
    }
}

function isValidPlace(place) {
    return Boolean(place) && typeof place.name === 'string'
        && Number.isFinite(place.lat) && Number.isFinite(place.lon);
}

function readRecentPlaces() {
    const places = readStorage(STORAGE_RECENT, []);
    return Array.isArray(places) ? places.filter(isValidPlace) : [];
}

function rememberPlace(place) {
    writeStorage(STORAGE_PLACE, place);
    const others = readRecentPlaces().filter(({ name, detail }) => name !== place.name || detail !== place.detail);
    writeStorage(STORAGE_RECENT, [place, ...others].slice(0, MAX_RECENT_PLACES));
}

// Lieu

function applyPlace(place) {
    const timeZone = place ? getLocationTimeZone(place.lat, place.lon) : null;
    const followsToday = state.day === state.today;

    state.place = place;
    state.zoneFromPlace = Boolean(timeZone);
    state.timeZone = timeZone || BROWSER_TIME_ZONE;
    state.today = toLocalDay(new Date());
    if (followsToday) state.day = state.today;

    document.documentElement.toggleAttribute('data-south', Boolean(place) && place.lat < 0);
    $('placeName').textContent = place ? place.name : 'Choisir un lieu';
    $('placeButton').title = place && place.detail ? `${place.name}, ${place.detail}` : '';

    buildStrip(state.day);
    renderDay();
}

function choosePlace(place, { remember = true } = {}) {
    const normalized = { ...place, lon: normalizeLongitude(place.lon) };
    closePlaceDialog();
    applyPlace(normalized);
    if (remember) rememberPlace(normalized);
    return normalized;
}

function formatCoordinates(lat, lon) {
    const format = (value) => numberFormats.oneDecimal.format(Math.abs(value));
    return `${format(lat)}° ${lat < 0 ? 'S' : 'N'}, ${format(lon)}° ${lon < 0 ? 'O' : 'E'}`;
}

// Choisit un lieu donné par ses coordonnées, puis lui trouve un nom sans faire attendre.
function choosePosition(lat, lon, fallbackName) {
    let place = choosePlace({ name: fallbackName, detail: formatCoordinates(lat, lon), lat, lon }, { remember: false });
    reverseGeocode(lat, lon)
        .then((named) => {
            if (!named || state.place !== place) return;
            place = { ...place, ...named };
            state.place = place;
            $('placeName').textContent = place.name;
        })
        .catch((error) => console.warn('Nom du lieu introuvable:', error))
        .finally(() => {
            if (state.place === place) rememberPlace(place);
        });
}

// Géocodage avec Photon (données OpenStreetMap), qui accepte la recherche au fil de la frappe.

async function searchPlaces(query, limit) {
    const params = new URLSearchParams({ q: query, limit: String(limit), lang: 'fr' });
    const response = await fetch(`${PHOTON_URL}/api/?${params}`);
    if (!response.ok) throw new Error(`Photon a répondu ${response.status}`);

    const data = await response.json();
    const places = (data.features || []).map(photonFeatureToPlace);
    return places.filter((place, index) => places.findIndex(({ label }) => label === place.label) === index);
}

// Coordonnées arrondies à environ 1 km : le nom d'une ville n'a pas besoin de plus.
async function reverseGeocode(lat, lon) {
    const params = new URLSearchParams({ lat: lat.toFixed(2), lon: lon.toFixed(2), lang: 'fr', limit: '1' });
    const response = await fetch(`${PHOTON_URL}/reverse?${params}`);
    if (!response.ok) throw new Error(`Photon a répondu ${response.status}`);

    const data = await response.json();
    const props = data.features && data.features[0] && data.features[0].properties;
    if (!props) return null;
    const name = props.city || props.district || props.county || props.name || props.state;
    if (!name) return null;
    return { name, detail: [props.state, props.country].filter((part) => part && part !== name).join(', ') };
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

// Panneau de choix du lieu

function setSearchStatus(message) {
    $('searchStatus').textContent = message || '';
    $('searchStatus').hidden = !message;
}

function createPlaceRow(iconName, main, detail) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'place-row';

    const text = document.createElement('span');
    text.className = 'place-row-text';
    const mainText = document.createElement('span');
    mainText.className = 'place-row-main';
    mainText.textContent = main;
    text.append(mainText);
    if (detail) {
        const detailText = document.createElement('span');
        detailText.className = 'place-row-detail';
        detailText.textContent = detail;
        text.append(detailText);
    }

    row.append(createIcon(iconName), text);
    const item = document.createElement('li');
    item.append(row);
    return { item, row };
}

function displayResults(places) {
    const items = places.map((place) => {
        const { item, row } = createPlaceRow('pin', place.main, place.detail);
        row.addEventListener('click', () => {
            choosePlace({ name: place.main, detail: place.detail, lat: place.lat, lon: place.lon });
        });
        return item;
    });
    $('searchResults').replaceChildren(...items);
    $('searchResults').hidden = items.length === 0;
}

function displayRecentPlaces() {
    const items = readRecentPlaces().map((place) => {
        const { item, row } = createPlaceRow('clock', place.name, place.detail);
        row.addEventListener('click', () => choosePlace(place));
        return item;
    });
    $('recentList').replaceChildren(...items);
    $('recentPlaces').hidden = items.length === 0;
}

function resetPlaceDialog() {
    clearTimeout(searchTimer);
    $('searchField').value = '';
    displayResults([]);
    setSearchStatus('');
    $('placeActions').hidden = false;
}

function openPlaceDialog() {
    resetPlaceDialog();
    displayRecentPlaces();
    $('forgetPlace').hidden = !state.place;
    $('placeDialog').showModal();
    // Sur téléphone, on garde les options visibles au lieu d'ouvrir le clavier d'office.
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) $('searchField').focus();
}

function closePlaceDialog() {
    if ($('placeDialog').open) $('placeDialog').close();
}

async function runSearch(query) {
    const places = await searchPlaces(query, 5);
    // Ignore une réponse arrivée après une saisie plus récente.
    if ($('searchField').value.trim() !== query) return null;
    displayResults(places);
    setSearchStatus(places.length ? '' : 'Aucun lieu trouvé.');
    return places;
}

function onSearchInput() {
    const query = $('searchField').value.trim();
    clearTimeout(searchTimer);
    $('placeActions').hidden = query.length > 0;

    if (query.length < 3) {
        displayResults([]);
        setSearchStatus('');
        return;
    }

    searchTimer = setTimeout(() => {
        runSearch(query).catch((error) => {
            console.warn('Recherche de lieu impossible:', error);
            displayResults([]);
            setSearchStatus('Recherche indisponible pour le moment.');
        });
    }, 300);
}

async function onSearchSubmit(event) {
    event.preventDefault();
    const query = $('searchField').value.trim();
    if (!query) return;
    clearTimeout(searchTimer);
    setSearchStatus('Recherche…');
    try {
        const places = await runSearch(query);
        if (places && places.length) {
            const [place] = places;
            choosePlace({ name: place.main, detail: place.detail, lat: place.lat, lon: place.lon });
        }
    } catch (error) {
        console.warn('Recherche de lieu impossible:', error);
        setSearchStatus('Recherche indisponible pour le moment.');
    }
}

function locateUser() {
    if (!navigator.geolocation) {
        setSearchStatus('La géolocalisation n’est pas disponible sur cet appareil.');
        return;
    }
    setSearchStatus('Localisation en cours…');
    navigator.geolocation.getCurrentPosition(
        (position) => {
            setSearchStatus('');
            choosePosition(position.coords.latitude, position.coords.longitude, 'Ma position');
        },
        (error) => {
            console.warn('Géolocalisation impossible:', error);
            setSearchStatus(error.code === error.PERMISSION_DENIED
                ? 'Accès à votre position refusé. Cherchez une ville ou choisissez sur la carte.'
                : 'Votre position n’a pas pu être déterminée. Cherchez une ville ou choisissez sur la carte.');
        },
        { timeout: 10000, maximumAge: 300000 }
    );
}

function loadLeaflet() {
    if (!leafletLoading) {
        leafletLoading = new Promise((resolve, reject) => {
            const style = document.createElement('link');
            style.rel = 'stylesheet';
            style.href = LEAFLET.style;
            style.integrity = LEAFLET.styleIntegrity;
            style.crossOrigin = 'anonymous';

            const script = document.createElement('script');
            script.src = LEAFLET.script;
            script.integrity = LEAFLET.scriptIntegrity;
            script.crossOrigin = 'anonymous';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Leaflet indisponible'));

            document.head.append(style, script);
        });
    }
    return leafletLoading;
}

function placeMapMarker(lat, lon) {
    if (mapMarker) mapMarker.remove();
    mapMarker = L.marker([lat, lon], {
        icon: L.divIcon({ className: 'map-pin', iconSize: [16, 16] })
    }).addTo(map);
}

async function toggleMap() {
    const container = $('mapContainer');
    const opening = container.hidden;
    container.hidden = !opening;
    $('mapButton').setAttribute('aria-expanded', String(opening));
    if (!opening) return;

    try {
        await loadLeaflet();
    } catch (error) {
        console.warn('Carte indisponible:', error);
        container.hidden = true;
        $('mapButton').setAttribute('aria-expanded', 'false');
        setSearchStatus('La carte n’a pas pu être chargée.');
        return;
    }

    if (!map) {
        map = L.map(container).setView([46.603354, 1.888334], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© contributeurs OpenStreetMap'
        }).addTo(map);
        map.attributionControl.setPrefix('Leaflet');
        map.on('click', ({ latlng }) => {
            placeMapMarker(latlng.lat, latlng.lng);
            choosePosition(latlng.lat, latlng.lng, 'Point sur la carte');
        });
    }

    map.invalidateSize();
    if (state.place) {
        map.setView([state.place.lat, state.place.lon], 8);
        placeMapMarker(state.place.lat, state.place.lon);
    }
    container.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
}

function forgetPlace() {
    if (state.place) {
        const { name, detail } = state.place;
        writeStorage(STORAGE_RECENT, readRecentPlaces().filter((place) => place.name !== name || place.detail !== detail));
    }
    writeStorage(STORAGE_PLACE, null);
    closePlaceDialog();
    applyPlace(null);
}

// Étoiles : dessinées une fois, sur deux calques pour le scintillement.

function drawStars() {
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const width = window.innerWidth;
    const height = Math.max(window.innerHeight, window.screen.height || 0);
    let seed = 20240408;
    const random = () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
    };

    [[$('stars'), 1 / 5200], [$('twinkles'), 1 / 19000]].forEach(([canvas, density]) => {
        canvas.width = width * scale;
        canvas.height = height * scale;
        const context = canvas.getContext('2d');
        context.scale(scale, scale);
        const count = Math.round(width * height * density);
        for (let i = 0; i < count; i++) {
            const size = 0.35 + random() ** 3 * 0.95;
            context.globalAlpha = 0.25 + random() * 0.65;
            context.fillStyle = random() < 0.2 ? '#ffe9cf' : '#dfe7ff';
            context.beginPath();
            context.arc(random() * width, random() * height, size, 0, Math.PI * 2);
            context.fill();
        }
    });
}

// Démarrage

function refreshClock() {
    if (document.hidden || !state.day) return;
    if (toLocalDay(new Date()) !== state.today) {
        applyPlace(state.place);
    } else if (state.day === state.today) {
        renderHero(new Date(), state.day);
        renderSky();
    }
}

function bindEvents() {
    strip.element.addEventListener('scroll', onStripScroll, { passive: true });
    strip.element.addEventListener('click', (event) => {
        const cell = event.target.closest('.day');
        if (cell) goToDay(cell.dataset.day);
    });

    const stage = $('moonStage');
    stage.addEventListener('pointerdown', onMoonPointerDown);
    stage.addEventListener('pointermove', onMoonPointerMove);
    stage.addEventListener('pointerup', onMoonPointerUp);
    stage.addEventListener('pointercancel', onMoonPointerUp);

    $('previousDay').addEventListener('click', () => goToDay(addDays(state.day, -1)));
    $('nextDay').addEventListener('click', () => goToDay(addDays(state.day, 1)));
    $('todayButton').addEventListener('click', () => goToDay(state.today));
    $('datePicker').addEventListener('change', (event) => {
        if (event.target.value) goToDay(event.target.value);
    });

    document.addEventListener('keydown', (event) => {
        if ($('placeDialog').open || event.target.matches('input')) return;
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        goToDay(addDays(state.day, event.key === 'ArrowLeft' ? -1 : 1));
    });

    $('nextPhases').addEventListener('click', (event) => {
        const row = event.target.closest('.phase-row');
        if (row) goToDayAndShow(row.dataset.day);
    });
    $('calendar').addEventListener('click', (event) => {
        const cell = event.target.closest('.calendar-day');
        if (cell) goToDayAndShow(cell.dataset.day);
    });
    $('previousMonth').addEventListener('click', () => changeMonth(-1));
    $('nextMonth').addEventListener('click', () => changeMonth(1));

    $('placeButton').addEventListener('click', openPlaceDialog);
    $('skyPlaceButton').addEventListener('click', openPlaceDialog);
    $('closePlaceDialog').addEventListener('click', closePlaceDialog);
    $('placeDialog').addEventListener('click', (event) => {
        if (event.target === event.currentTarget) closePlaceDialog();
    });
    $('searchField').addEventListener('input', onSearchInput);
    $('searchForm').addEventListener('submit', onSearchSubmit);
    $('locateButton').addEventListener('click', locateUser);
    $('mapButton').addEventListener('click', toggleMap);
    $('forgetPlace').addEventListener('click', forgetPlace);

    let starsWidth = window.innerWidth;
    window.addEventListener('resize', () => {
        strip.cell = strip.element.firstElementChild.getBoundingClientRect().width;
        strip.element.scrollLeft = daysBetween(strip.start, state.day) * strip.cell;
        // Sur téléphone, la barre d'adresse change la hauteur : seul un changement de largeur compte.
        if (window.innerWidth !== starsWidth) {
            starsWidth = window.innerWidth;
            drawStars();
        }
    });

    document.addEventListener('visibilitychange', refreshClock);
    setInterval(refreshClock, 60000);
}

function start() {
    drawStars();

    if (typeof SunCalc === 'undefined') {
        $('errorMessage').textContent = 'Les calculs n’ont pas pu démarrer. Vérifiez votre connexion, puis rechargez la page.';
        $('errorMessage').hidden = false;
        return;
    }

    const savedPlace = readStorage(STORAGE_PLACE, null);
    state.today = toLocalDay(new Date());
    state.day = state.today;
    bindEvents();
    applyPlace(isValidPlace(savedPlace) ? savedPlace : null);

    moon.ready.then(() => {
        renderHero(instantFor(state.day), state.day);
        $('moonStage').classList.add('is-ready');
    });
}

document.addEventListener('DOMContentLoaded', start);
