// Rendu de la Lune, en deux versions qui suivent le même modèle : phase et inclinaison réelles.
// Réaliste : une vraie carte du disque visible (NASA), éclairée pixel par pixel.
// Dessinée : un dessin vectoriel, avec une ombre découpée selon la phase et des cratères qui suivent le Soleil.
// Les deux sont orientées nord en haut, comme vues de l'hémisphère nord.
const MoonRenderer = (() => {
    const MAX_SIZE = 720;
    const MIN_SIZE = 360;
    const RELIEF_SCALE = 0.45; // valeur utilisée au précalcul de images/moon-relief.webp
    const LIGHT_STEPS = 1024;

    // Teinte de la lumière du Soleil et de la lumière cendrée renvoyée par la Terre.
    const SUN_TINT = [1, 0.975, 0.93];
    const EARTH_TINT = [0.62, 0.72, 0.95];
    // Couleur du disque dans l'ombre, proche du ciel pour qu'il s'y fonde.
    const SHADOW = [9, 12, 24];

    // La surface de la Lune suit la loi de Lommel-Seeliger, et non celle d'une sphère mate :
    // c'est pour cela que la pleine lune paraît plate, sans assombrissement sur les bords.
    const LIGHT_CURVE = new Float32Array(LIGHT_STEPS + 1);
    for (let i = 0; i <= LIGHT_STEPS; i++) {
        LIGHT_CURVE[i] = Math.min(1, 2 * i / LIGHT_STEPS) ** 0.75;
    }

    function loadImage(src) {
        const image = new Image();
        image.src = src;
        return image.decode().then(() => image);
    }

    function readPixels(image, width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0, width, height);
        return context.getImageData(0, 0, width, height).data;
    }

    function create(canvas) {
        const deviceSize = canvas.getBoundingClientRect().width * (window.devicePixelRatio || 1);
        const size = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, deviceSize)));
        canvas.width = size;
        canvas.height = size;

        const context = canvas.getContext('2d');
        const frame = context.createImageData(size, size);
        const pixels = frame.data;

        // Tout ce qui ne dépend pas de la phase est calculé une seule fois.
        const radius = size / 2 - 1;
        const center = (size - 1) / 2;
        const limit = (radius + 1) ** 2;
        const offsets = [];
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = x - center;
                const dy = y - center;
                if (dx * dx + dy * dy < limit) offsets.push(y * size + x);
            }
        }
        const count = offsets.length;
        const nx = new Float32Array(count);
        const ny = new Float32Array(count);
        const nz = new Float32Array(count);
        const reliefX = new Float32Array(count);
        const reliefY = new Float32Array(count);
        const albedo = new Float32Array(count).fill(205);
        for (let i = 0; i < count; i++) {
            const x = offsets[i] % size;
            const y = (offsets[i] - x) / size;
            const px = (x - center) / radius;
            const py = (center - y) / radius;
            const r2 = Math.min(1, px * px + py * py);
            nx[i] = px;
            ny[i] = py;
            nz[i] = Math.sqrt(1 - r2);
            pixels[offsets[i] * 4 + 3] = Math.max(0, Math.min(1, (1 - Math.sqrt(px * px + py * py)) * radius + 0.5)) * 255;
        }

        const ready = Promise.all([loadImage('images/moon-albedo.webp'), loadImage('images/moon-relief.webp')])
            .then(([albedoImage, reliefImage]) => {
                const albedoPixels = readPixels(albedoImage, size, size);
                const reliefPixels = readPixels(reliefImage, size * 2, size);
                for (let i = 0; i < count; i++) {
                    const x = offsets[i] % size;
                    const y = (offsets[i] - x) / size;
                    albedo[i] = albedoPixels[offsets[i] * 4];
                    reliefX[i] = (reliefPixels[(y * size * 2 + x) * 4] - 127.5) / 127.5 * RELIEF_SCALE;
                    reliefY[i] = (reliefPixels[(y * size * 2 + x + size) * 4] - 127.5) / 127.5 * RELIEF_SCALE;
                }
            })
            .catch((error) => {
                // Sans les images, le disque reste juste : seule la texture manque.
                console.warn('Images de la Lune indisponibles:', error);
            });

        // `fraction` et `angle` viennent de SunCalc.getMoonIllumination : `angle` est la position
        // du limbe éclairé en degrés, comptée du nord vers l'est (l'est est à gauche dans le ciel).
        function draw({ fraction, angle }) {
            const cosIncidence = 2 * fraction - 1;
            const sinIncidence = Math.sqrt(Math.max(0, 1 - cosIncidence * cosIncidence));
            const limb = angle * Math.PI / 180;
            const sunX = -Math.sin(limb) * sinIncidence;
            const sunY = Math.cos(limb) * sinIncidence;
            const sunZ = cosIncidence;
            const earthshine = 0.012 + 0.075 * (1 - fraction) ** 2;

            for (let i = 0; i < count; i++) {
                const incidence = (nx[i] + reliefX[i]) * sunX + (ny[i] + reliefY[i]) * sunY + nz[i] * sunZ;
                const light = incidence > 0
                    ? LIGHT_CURVE[(incidence / (incidence + nz[i] + 0.02) * LIGHT_STEPS) | 0]
                    : 0;
                const surface = albedo[i];
                const shadow = (1 - light) * (1 - light);
                const p = offsets[i] * 4;
                pixels[p] = surface * (light * SUN_TINT[0] + earthshine * EARTH_TINT[0]) + SHADOW[0] * shadow;
                pixels[p + 1] = surface * (light * SUN_TINT[1] + earthshine * EARTH_TINT[1]) + SHADOW[1] * shadow;
                pixels[p + 2] = surface * (light * SUN_TINT[2] + earthshine * EARTH_TINT[2]) + SHADOW[2] * shadow;
            }
            context.putImageData(frame, 0, 0);
        }

        return { ready, draw };
    }

    // Le dessin de la Lune, avec par-dessus la nuit et une bande de pénombre, découpées selon la phase.
    function createCartoon(svg) {
        const surface = svg.querySelector('#moonSurface');
        const dusk = svg.querySelector('#moonDusk');
        const night = svg.querySelector('#moonNight');
        const NIGHT_EDGE = 1.004; // déborde du disque pour couvrir le liseré clair du bord
        const DUSK_WIDTH = 0.09;
        const RELIEF = 0.1; // décalage des ombres d'un cratère, en part de son rayon

        function addShape(tag, className, attributes) {
            const shape = document.createElementNS('http://www.w3.org/2000/svg', tag);
            shape.setAttribute('class', className);
            Object.entries(attributes).forEach(([name, value]) => shape.setAttribute(name, value));
            surface.append(shape);
            return shape;
        }

        MOON_DRAWING.maria.forEach((d) => addShape('path', 'cartoon-mare', { d }));
        MOON_DRAWING.rays.forEach((d) => addShape('path', 'cartoon-ray', { d }));

        MOON_DRAWING.pits.forEach(([x, y, rx, ry, angle]) => {
            const transform = `translate(${x} ${y}) rotate(${angle})`;
            addShape('ellipse', 'cartoon-pit-wall', { rx, ry, transform });
            addShape('ellipse', 'cartoon-pit-floor', { rx: rx * 0.72, ry: ry * 0.72, transform: `${transform} translate(${rx * 0.12} ${ry * 0.12})` });
        });

        const craters = MOON_DRAWING.craters.map(([x, y, rx, ry, angle]) => {
            const rim = addShape('ellipse', 'cartoon-rim', { rx: rx * 1.1, ry: ry * 1.1 });
            addShape('ellipse', 'cartoon-wall', { rx, ry, transform: `translate(${x} ${y}) rotate(${angle})` });
            const floor = addShape('ellipse', 'cartoon-floor', { rx: rx * 0.84, ry: ry * 0.84 });
            return { x, y, angle, rim, floor, reach: Math.min(rx, ry) * RELIEF };
        });

        // Zone sombre : du limbe opposé au Soleil jusqu'à la frontière jour/nuit, tracée limbe éclairé à droite.
        function shadowPath(terminator) {
            const edge = NIGHT_EDGE;
            const sweep = terminator > 0 ? 0 : 1;
            return `M0-${edge}A${edge} ${edge} 0 0 0 0 ${edge}A${Math.abs(terminator).toFixed(4)} ${edge} 0 0 ${sweep} 0-${edge}Z`;
        }

        // Même `fraction` et même `angle` que pour la version réaliste.
        function draw({ fraction, angle }) {
            const limb = angle * Math.PI / 180;
            const rotation = Math.atan2(-Math.cos(limb), -Math.sin(limb)) * 180 / Math.PI;
            const placement = `translate(1000 1000) scale(1000) rotate(${rotation.toFixed(2)})`;

            // Frontière sur l'équateur de la Lune : -1 à la pleine lune, +1 à la nouvelle lune.
            const terminator = 1 - 2 * fraction;
            const duskEdge = Math.min(1, terminator + DUSK_WIDTH * (1 - terminator * terminator));
            night.setAttribute('d', shadowPath(terminator));
            night.setAttribute('transform', placement);
            dusk.setAttribute('d', shadowPath(duskEdge));
            dusk.setAttribute('transform', placement);

            // Le Soleil éclaire le rebord tourné vers lui et laisse dans l'ombre la paroi de ce côté :
            // à la pleine lune il est de face, et les cratères n'ont plus d'ombre.
            const sinIncidence = 2 * Math.sqrt(fraction * (1 - fraction));
            const sunX = -Math.sin(limb) * sinIncidence;
            const sunY = -Math.cos(limb) * sinIncidence;
            craters.forEach(({ x, y, angle: tilt, rim, floor, reach }) => {
                const dx = sunX * reach;
                const dy = sunY * reach;
                rim.setAttribute('transform', `translate(${(x + dx).toFixed(1)} ${(y + dy).toFixed(1)}) rotate(${tilt})`);
                floor.setAttribute('transform', `translate(${(x - dx).toFixed(1)} ${(y - dy).toFixed(1)}) rotate(${tilt})`);
            });
        }

        return { ready: Promise.resolve(), draw };
    }

    return { create, createCartoon };
})();
