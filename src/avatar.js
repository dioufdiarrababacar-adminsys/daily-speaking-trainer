// Avatars en aplats : 8 identités × 7 expressions, 8 couches SVG nommées.
(function () {
  const INK = '#241A33';
  const MOUTH = '#5B2338';

  const PEOPLE = {
    lea:    { gender: 'f', name: 'Léa',    role: 'examinatrice patiente',   voice: 'Voix grave, calme',        bg: '#DCD3FF', accent: '#6D3BFF', accentDark: '#8F63FF', pastel: 'lavande',     skin: '#F2C9A6', hair: 'ponytail', hairColor: '#F0C24B', top: '#2B2340', extras: ['earrings'],           pitch: 0.9, rate: 0.95 },
    marcus: { gender: 'm', name: 'Marcus', role: 'pote bavard',             voice: 'Voix chaude, rapide',      bg: '#C7EFDC', accent: '#0F9E74', accentDark: '#3BC59A', pastel: 'menthe',      skin: '#8B5A34', hair: 'curly',    hairColor: '#2A1C18', top: '#FF5A4E', extras: ['beard'],              pitch: 0.8, rate: 1.05 },
    ingrid: { gender: 'f', name: 'Ingrid', role: 'prof exigeante',          voice: 'Voix nette, posée',        bg: '#FFD5CE', accent: '#E23D31', accentDark: '#FF6A5E', pastel: 'corail',      skin: '#F7DCC4', hair: 'bun',      hairColor: '#E8E4EC', top: '#15112B', extras: ['glasses'],            pitch: 1.0, rate: 0.9 },
    diego:  { gender: 'm', name: 'Diego',  role: 'journaliste curieux',     voice: 'Voix vive, curieuse',      bg: '#CCEBFA', accent: '#0E93B4', accentDark: '#3FC1E0', pastel: 'bleu ciel',   skin: '#D79A6E', hair: 'crest',    hairColor: '#2ED3F0', top: '#FFC533', extras: ['mole'],               pitch: 0.95, rate: 1.05 },
    amina:  { gender: 'f', name: 'Amina',  role: 'guide de voyage',         voice: 'Voix souriante',           bg: '#FFECB8', accent: '#B07A00', accentDark: '#E0A21A', pastel: 'jaune pâle',  skin: '#A9714B', hair: 'afro',     hairColor: '#33211B', top: '#6D3BFF', extras: ['earrings', 'freckles'], pitch: 1.1, rate: 1.0 },
    yuki:   { gender: 'f', name: 'Yuki',   role: 'collègue curieuse',       voice: 'Voix douce, précise',      bg: '#FBD7E6', accent: '#C43A7C', accentDark: '#E86AA6', pastel: 'rose poudré', skin: '#F7D2B0', hair: 'long',     hairColor: '#FF7FB6', top: '#15112B', extras: ['glasses'],            pitch: 1.15, rate: 0.95 },
    otto:   { gender: 'm', name: 'Otto',   role: 'voisin nostalgique',      voice: 'Voix lente, grave',        bg: '#EFE0C8', accent: '#8A6224', accentDark: '#B8894A', pastel: 'sable',       skin: '#EBB88E', hair: 'bald',     hairColor: '#CFC9C2', top: '#2ED3F0', extras: ['mustache', 'glasses'], pitch: 0.75, rate: 0.85 },
    priya:  { gender: 'f', name: 'Priya',  role: 'recruteuse bienveillante', voice: 'Voix claire, encourageante', bg: '#E2F5BE', accent: '#5F8A00', accentDark: '#8DBF1F', pastel: 'tilleul',   skin: '#7A4A2C', hair: 'short',    hairColor: '#1C1418', top: '#FF5A4E', extras: ['earrings', 'mole'],   pitch: 1.05, rate: 1.0 }
  };

  const EXPR = {
    neutral:   { eye: 'dot', eyeR: 3,   browY: 35, browTilt: 0, mouth: 'smile', rot: 0,  gaze: [0, 0] },
    speak:     { eye: 'dot', eyeR: 3,   browY: 34, browTilt: 0, mouth: 'open',  rot: 0,  gaze: [0, 0] },
    listen:    { eye: 'dot', eyeR: 3.4, browY: 32, browTilt: 0, mouth: 'small', rot: 2,  gaze: [1.5, 0.5] },
    nod:       { eye: 'arc', eyeR: 3,   browY: 34, browTilt: 0, mouth: 'smile', rot: -7, gaze: [0, 0] },
    surprise:  { eye: 'dot', eyeR: 4.4, browY: 29, browTilt: 0, mouth: 'o',     rot: 0,  gaze: [0, -1] },
    encourage: { eye: 'arc', eyeR: 3,   browY: 33, browTilt: 0, mouth: 'grin',  rot: 0,  gaze: [0, 0] },
    think:     { eye: 'dot', eyeR: 3,   browY: 33, browTilt: 8, mouth: 'think', rot: 4,  gaze: [-1.5, -2] }
  };

  function el(tag, attrs, children) {
    let s = '<' + tag;
    for (const k in attrs) {
      if (attrs[k] === undefined || attrs[k] === null) continue;
      s += ' ' + k + '="' + String(attrs[k]).replace(/"/g, '&quot;') + '"';
    }
    if (!children || (Array.isArray(children) && !children.length)) return s + '/>';
    return s + '>' + (Array.isArray(children) ? children.join('') : children) + '</' + tag + '>';
  }

  function mouthShape(kind) {
    const dark = (d) => el('path', { d, fill: MOUTH });
    const white = (d) => el('path', { d, fill: '#FFFFFF' });
    switch (kind) {
      case 'smile': return dark('M39,55 a11,11 0 0 0 22,0 z') + white('M41,55 a9,9 0 0 0 18,0 z');
      case 'grin':  return dark('M35,54 a15,15 0 0 0 30,0 z') + white('M37.5,54 a12.5,12.5 0 0 0 25,0 z');
      case 'small': return el('ellipse', { cx: 50, cy: 57, rx: 6, ry: 3.4, fill: MOUTH }) + white('M44.4,56.2 a6,3.4 0 0 0 11.2,0 z');
      case 'open':  return el('ellipse', { cx: 50, cy: 58, rx: 7, ry: 7.5, fill: MOUTH }) + white('M43.4,56 a7,4 0 0 1 13.2,0 z');
      case 'o':     return el('circle', { cx: 50, cy: 58, r: 4.6, fill: MOUTH });
      case 'wide':  return el('ellipse', { cx: 50, cy: 57, rx: 9, ry: 4.5, fill: MOUTH }) + white('M42,56 a8,3 0 0 1 16,0 z');
      case 'ee':    return el('rect', { x: 41, y: 55.5, width: 18, height: 4, rx: 2, fill: MOUTH }) + white('M43,56 h14 v1.5 h-14 z');
      default:      return el('rect', { x: 48, y: 56, width: 10, height: 4, rx: 2, fill: MOUTH });
    }
  }

  function render(who, expression, opts) {
    opts = opts || {};
    const p = PEOPLE[who] || PEOPLE.lea;
    const x = EXPR[expression] || EXPR.neutral;
    const only = opts.layer && opts.layer !== 'all' ? opts.layer : null;
    const op = (k) => (only ? (only === k ? 1 : 0.1) : 1);
    const L = [];

    if (!opts.nobg) L.push(el('rect', { class: 'av-bg', x: 0, y: 0, width: 100, height: 100, fill: p.bg, opacity: op('bg') }));

    const back = [];
    if (p.hair === 'afro') back.push(el('circle', { cx: 50, cy: 42, r: 30, fill: p.hairColor }));
    else if (p.hair === 'crest') back.push(el('rect', { x: 42, y: 7, width: 16, height: 36, rx: 8, fill: p.hairColor }));
    else if (p.hair !== 'bald') back.push(el('circle', { cx: 50, cy: 44, r: 26, fill: p.hairColor }));
    if (p.hair === 'curly') [[31, 33, 9], [43, 25, 10], [58, 25, 10], [70, 34, 9]].forEach((c) => back.push(el('circle', { cx: c[0], cy: c[1], r: c[2], fill: p.hairColor })));
    if (p.hair === 'ponytail') {
      back.push(el('ellipse', { cx: 80, cy: 54, rx: 9, ry: 14, fill: p.hairColor }));
      back.push(el('circle', { cx: 71, cy: 40, r: 5, fill: p.accent }));
    }
    if (p.hair === 'bun') back.push(el('circle', { cx: 50, cy: 14, r: 11, fill: p.hairColor }));
    if (back.length) L.push(el('g', { class: 'av-hair av-hair-back', opacity: op('hair') }, back));

    L.push(el('g', { class: 'av-bust', opacity: op('bust') }, [
      el('rect', { x: 43, y: 60, width: 14, height: 20, rx: 6, fill: p.skin }),
      el('rect', { x: 19, y: 78, width: 62, height: 32, rx: 20, fill: p.top }),
      el('path', { d: 'M43,78 q7,9 14,0 z', fill: '#FFFFFF', opacity: 0.22 })
    ]));

    const headG = el('g', { class: 'av-head', opacity: op('head') }, [
      el('circle', { cx: 27, cy: 50, r: 4.5, fill: p.skin }),
      el('circle', { cx: 73, cy: 50, r: 4.5, fill: p.skin }),
      el('circle', { cx: 50, cy: 47, r: 23, fill: p.skin })
    ]);

    const front = [];
    if (p.hair === 'long') {
      front.push(el('rect', { x: 22, y: 42, width: 11, height: 38, rx: 5.5, fill: p.hairColor }));
      front.push(el('rect', { x: 67, y: 42, width: 11, height: 38, rx: 5.5, fill: p.hairColor }));
    }
    if (p.hair === 'short' || p.hair === 'ponytail') {
      front.push(el('path', { d: 'M27,43 q5,-19 23,-19 q18,0 23,19 q-11,-10 -23,-10 q-12,0 -23,10 z', fill: p.hairColor }));
    }
    const frontG = front.length ? el('g', { class: 'av-hair av-hair-front', opacity: op('hair') }, front) : '';

    const bw = 11, by = x.browY;
    const brows = el('g', { class: 'av-brows', opacity: op('brows'), fill: p.hairColor }, [
      el('rect', { x: 34, y: by, width: bw, height: 3, rx: 1.5, transform: 'rotate(' + (-x.browTilt) + ' 39.5 ' + (by + 1.5) + ')' }),
      el('rect', { x: 55, y: by, width: bw, height: 3, rx: 1.5, transform: 'rotate(' + (x.browTilt * 0.2) + ' 60.5 ' + (by + 1.5) + ')' })
    ]);

    const gx = x.gaze[0], gy = x.gaze[1];
    const eyes = x.eye === 'arc'
      ? el('g', { class: 'av-eyes', opacity: op('eyes'), stroke: INK, 'stroke-width': 3, 'stroke-linecap': 'round', fill: 'none' }, [
          el('path', { d: 'M36,47 q4,-5 8,0' }), el('path', { d: 'M56,47 q4,-5 8,0' })])
      : el('g', { class: 'av-eyes', opacity: op('eyes'), fill: INK }, [
          el('circle', { cx: 40 + gx, cy: 45 + gy, r: x.eyeR }), el('circle', { cx: 60 + gx, cy: 45 + gy, r: x.eyeR })]);

    const mouth = el('g', { class: 'av-mouth', opacity: op('mouth') }, mouthShape(x.mouth));

    const ex = [];
    if (p.extras.includes('glasses')) ex.push(el('g', { fill: 'none', stroke: INK, 'stroke-width': 2.2 }, [
      el('rect', { x: 31, y: 38, width: 18, height: 15, rx: 7.5 }), el('rect', { x: 51, y: 38, width: 18, height: 15, rx: 7.5 }), el('path', { d: 'M49,45 h2' })]));
    if (p.extras.includes('earrings')) ex.push(el('g', { fill: p.accent }, [el('circle', { cx: 26, cy: 57, r: 3.2 }), el('circle', { cx: 74, cy: 57, r: 3.2 })]));
    if (p.extras.includes('beard')) ex.push(el('path', { d: 'M30,50 q0,22 20,22 q20,0 20,-22 q-6,14 -20,14 q-14,0 -20,-14 z', fill: p.hairColor }));
    if (p.extras.includes('mustache')) ex.push(el('path', { d: 'M40,51 q10,-5 20,0 q-10,5 -20,0 z', fill: p.hairColor }));
    if (p.extras.includes('freckles')) ex.push(el('g', { fill: INK, opacity: 0.28 }, [
      el('circle', { cx: 34, cy: 52, r: 1.2 }), el('circle', { cx: 38, cy: 55, r: 1.2 }), el('circle', { cx: 66, cy: 52, r: 1.2 }), el('circle', { cx: 62, cy: 55, r: 1.2 })]));
    if (p.extras.includes('mole')) ex.push(el('circle', { cx: 63, cy: 60, r: 1.6, fill: INK, opacity: 0.5 }));
    const exG = ex.length ? el('g', { class: 'av-extras', opacity: op('extras') }, ex) : '';

    const beardFirst = p.extras.includes('beard') || p.extras.includes('mustache');
    const headWrap = el('g', { class: 'av-headwrap', style: 'transform:rotate(' + x.rot + 'deg)' },
      [headG, frontG, beardFirst ? exG : '', brows, eyes, mouth, beardFirst ? '' : exG]);
    L.push(headWrap);

    return el('svg', {
      class: 'avatar', viewBox: '0 0 100 100', width: '100%', height: '100%', preserveAspectRatio: 'xMidYMid meet', role: 'img',
      'aria-label': 'Avatar ' + p.name + ', expression ' + (expression || 'neutral'),
      'data-who': who, 'data-expression': expression || 'neutral'
    }, L);
  }

  // Remplace uniquement la bouche (visèmes pendant que le coach parle).
  function setMouth(svg, kind) {
    const m = svg && svg.querySelector('.av-mouth');
    if (m) m.innerHTML = mouthShape(kind);
  }

  // Applique une expression sans re-rendre le SVG : rotation animée par CSS, bouche/yeux/sourcils remplacés.
  function setExpression(svg, who, expression) {
    if (!svg) return;
    const fresh = document.createElement('div');
    fresh.innerHTML = render(who, expression, { nobg: true });
    const next = fresh.firstElementChild;
    ['.av-brows', '.av-eyes', '.av-mouth'].forEach((sel) => {
      const cur = svg.querySelector(sel), nu = next.querySelector(sel);
      if (cur && nu) cur.replaceWith(nu);
    });
    const hw = svg.querySelector('.av-headwrap');
    if (hw) hw.style.transform = next.querySelector('.av-headwrap').style.transform;
    svg.dataset.expression = expression;
  }

  window.Avatar = { PEOPLE, EXPR, render, setMouth, setExpression };
})();
