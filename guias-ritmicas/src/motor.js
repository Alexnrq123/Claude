/* ===================================================================
   Motor de guías rítmicas: análisis del texto + dibujo SVG de la hoja.
   Todo es puro (sin DOM salvo un canvas para medir texto).
   =================================================================== */

const GR = (() => {
  // ---------- Fuentes (se inyectan al construir) ----------
  const FONTS = window.__GR_FONTS__;
  const FAM = {
    J: { mus: "GRMusJ", txt: "GRTxtJ", txtW: 400, txtWB: 400 },
    C: { mus: "GRMusC", txt: "GRTxtC", txtW: 500, txtWB: 700 },
  };
  function fontFaceCSS() {
    const f = (fam, b64, w) =>
      `@font-face{font-family:'${fam}';src:url(data:font/woff2;base64,${b64}) format('woff2');font-weight:${w};font-style:normal;font-display:block}`;
    return [
      f("GRMusJ", FONTS.petaluma, 400),
      f("GRMusC", FONTS.bravura, 400),
      f("GRTxtJ", FONTS.pscript, 400),
      f("GRTxtC", FONTS.barlow500, 500),
      f("GRTxtC", FONTS.barlow700, 700),
    ].join("\n");
  }

  // Métricas SMuFL (en espacios de pentagrama) tomadas de metadata.json
  const MET = {
    J: { sharpW: 1.65, flatW: 0.9, tsScale: 0.58, tsW: 2.55, slashW: 1.952, stemX: 1.952, stemY: 0.884,
         halfW: 2.92, halfStemY: 0.836, wholeW: 3.82, restWholeW: 2.0, restHalfW: 2.07, restQW: 1.05, rest8W: 1.16,
         accentW: 1.7, fermataW: 1.888, codaW: 5.52, segnoW: 3.19, rep1W: 2.4, clefW: 2.66, dotW: 0.38, flagW: 1.04 },
    C: { sharpW: 1.0, flatW: 0.9, tsScale: 1, tsW: 1.8, slashW: 2.12, stemX: 2.12, stemY: 1.0,
         halfW: 3.12, halfStemY: 1.0, wholeW: 3.92, restWholeW: 1.13, restHalfW: 1.13, restQW: 1.08, rest8W: 0.99,
         accentW: 1.356, fermataW: 2.42, codaW: 3.82, segnoW: 2.2, rep1W: 2.13, clefW: 2.68, dotW: 0.4, flagW: 1.06 },
  };
  const G = {
    gClef: "\uE050", sharp: "\uE262", flat: "\uE260", natural: "\uE261",
    slash: "\uE101", slashWhole: "\uE102", slashHalf: "\uE103", diamondWhole: "\uE0D8", diamondHalf: "\uE0D9",
    restWhole: "\uE4E3", restHalf: "\uE4E4", restQuarter: "\uE4E5", rest8: "\uE4E6",
    flag8Up: "\uE240", flag8Down: "\uE241", dot: "\uE1E7", accentBelow: "\uE4A1", fermata: "\uE4C0",
    segno: "\uE047", coda: "\uE048", rep1: "\uE500", metQ: "\uECA5",
  };
  const tsDigit = (d) => String.fromCharCode(0xe080 + +d);

  // ---------- Medición de texto ----------
  let _ctx;
  function textW(str, family, size, weight = 400) {
    if (!_ctx) _ctx = document.createElement("canvas").getContext("2d");
    _ctx.font = `${weight} ${size}px '${family}'`;
    return _ctx.measureText(str).width;
  }
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // ---------- Teoría: acordes y tonalidades ----------
  const LAT2AM = { Do: "C", Re: "D", Mi: "E", Fa: "F", Sol: "G", La: "A", Si: "B" };
  const AM2LAT = { C: "Do", D: "Re", E: "Mi", F: "Fa", G: "Sol", A: "La", B: "Si" };
  const ROOT_RE = /^(Do|Re|Mi|Fa|Sol|La|Si|[A-G])(#|b|♯|♭)?/;

  function readRoot(s) {
    // normaliza mayúscula inicial para cifrado latino ("sol" -> "Sol")
    const t = s.replace(/^(do|re|mi|fa|sol|la|si)/i, (m) => m[0].toUpperCase() + m.slice(1).toLowerCase());
    let m = t.match(ROOT_RE);
    if (!m) return null;
    let name = m[1];
    // "Fadd9" en americano no es "Fa"
    if (name === "Fa" && /^Fadd/.test(t)) m = t.match(/^(F)(#|b|♯|♭)?/), (name = "F");
    if (name === "Do" && /^Do(?!m|M|\d|#|b|♯|♭|\/|\(|s|a|d|\+|$)/.test(t)) return null;
    const am = LAT2AM[name] || name;
    let acc = m[2] || "";
    acc = acc === "♯" ? "#" : acc === "♭" ? "b" : acc;
    return { root: am, acc, len: m[0].length };
  }

  function parseChord(tok) {
    let t = tok;
    let hold = false, fermata = false;
    while (/[*^]$/.test(t)) {
      if (t.endsWith("*")) hold = true;
      if (t.endsWith("^")) fermata = true;
      t = t.slice(0, -1);
    }
    const r = readRoot(t);
    if (!r) return null;
    let rest = t.slice(r.len);
    let bass = null;
    const si = rest.lastIndexOf("/");
    if (si >= 0) {
      const b = readRoot(rest.slice(si + 1));
      if (b && b.len === rest.length - si - 1) {
        bass = { root: b.root, acc: b.acc };
        rest = rest.slice(0, si);
      }
    }
    if (/\s/.test(rest)) return null;
    return { root: r.root, acc: r.acc, qual: rest, bass, hold, fermata, src: tok };
  }

  const KEYS = {
    C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
    Am: 0, Em: 1, Bm: 2, "F#m": 3, "C#m": 4, "G#m": 5, "D#m": 6, "A#m": 7, Dm: -1, Gm: -2, Cm: -3, Fm: -4, Bbm: -5, Ebm: -6, Abm: -7,
  };
  function keyCount(tono) {
    if (!tono) return 0;
    const c = parseChord(String(tono).trim().split(/\s+/)[0]);
    if (!c) return 0;
    const minor = /^m(?!aj)|^min|^menor/i.test(c.qual) || /menor/i.test(tono);
    const k = c.root + c.acc + (minor ? "m" : "");
    return KEYS[k] ?? 0;
  }

  // ---------- Análisis del texto ----------
  function parseTime(s) {
    const m = String(s || "4/4").match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
    const num = m ? +m[1] : 4, den = m ? +m[2] : 4;
    const compound = den === 8 && num % 3 === 0 && num > 3;
    const eighths = den === 8 ? num : den === 2 ? num * 4 : num * 2;
    const beats = compound ? num / 3 : den === 8 ? num : den === 2 ? num * 2 : num;
    const group = compound ? 3 : 2;
    return { num, den, compound, eighths, beats, group, label: `${num}/${den}` };
  }

  const BAR_RE = /^(:\|:|\|\|:|\|:|:\|\||:\||\|\]|\|\||\|)$/;
  const TOKEN_RE = /(:\|:|\|\|:|\|:|:\|\||:\||\|\]|\|\||\|)|(\[[^\]\n]*\]?|"[^"\n]*"?|“[^”\n]*”?|\([^)\n]*\)?|\{[^}\n]*\}?)|([^\s|\[\]{}"“”(:][^\s|\[\]{}"“”:]*(?::\d+\.?)?)|(\S)/g;

  function normBar(b) {
    if (b === "||:") return "|:";
    if (b === ":||") return ":|";
    return b;
  }
  function mergeBars(a, b) {
    if (!a || a === "|") return b;
    if (b === "|") return a;
    if ((a === ":|" && b === "|:") || (a === "|:" && b === ":|")) return ":|:";
    return b;
  }

  function parse(song) {
    const body = song.cuerpo || "";
    const baseTime = parseTime(song.compas);
    const warnings = [];
    const measures = [];
    let cur = null;
    let pendingLeft = null;
    let pendingBreak = false;
    let time = baseTime;

    const newMeasure = () => ({ toks: [], start: -1, end: -1, leftBar: pendingLeft, breakBefore: pendingBreak });

    const finish = (rightBar) => {
      if (!cur || cur.toks.length === 0) {
        // barra sin contenido: se fusiona con la anterior
        if (measures.length && rightBar) {
          const prev = measures[measures.length - 1];
          prev.rightBar = mergeBars(prev.rightBar, rightBar);
        } else if (rightBar) pendingLeft = mergeBars(pendingLeft, rightBar);
        return;
      }
      cur.rightBar = rightBar || "|";
      const m = interpret(cur, measures.length + 1, time, warnings);
      if (m.timeChange) time = m.time;
      m.time = time;
      if (pendingLeft && !m.leftBar) m.leftBar = pendingLeft;
      measures.push(m);
      pendingLeft = null;
      pendingBreak = false;
      cur = null;
    };

    let offset = 0;
    const lines = body.split("\n");
    for (const line of lines) {
      if (/^\s*#/.test(line)) { offset += line.length + 1; continue; }
      let any = false;
      TOKEN_RE.lastIndex = 0;
      let mm;
      while ((mm = TOKEN_RE.exec(line))) {
        const [full, bar, grp, word, other] = mm;
        const s = offset + mm.index, e = s + full.length;
        if (bar) {
          const b = normBar(bar);
          if (!cur || !cur.toks.length) {
            if (measures.length && !(cur && cur.breakBefore && !any)) {
              const prev = measures[measures.length - 1];
              if (any || !pendingBreak) prev.rightBar = mergeBars(prev.rightBar, b);
              else if (b === "|:" || b === ":|:") {
                if (b === ":|:") prev.rightBar = mergeBars(prev.rightBar, ":|");
                pendingLeft = "|:";
              } else prev.rightBar = mergeBars(prev.rightBar, b);
            } else if (b === "|:" || b === ":|:") pendingLeft = "|:";
            else if (measures.length) {
              measures[measures.length - 1].rightBar = mergeBars(measures[measures.length - 1].rightBar, b);
            }
          } else finish(b);
          continue;
        }
        if (!cur) cur = newMeasure();
        if (cur.start < 0) cur.start = s;
        cur.end = e;
        cur.toks.push({ v: full, grp: !!grp, other: !!other, s, e });
        any = true;
      }
      if (cur && cur.toks.length) finish("|");
      cur = null;
      if (any || measures.length) pendingBreak = true;
      offset += line.length + 1;
    }
    if (measures.length) {
      const last = measures[measures.length - 1];
      if (last.rightBar === "|" || !last.rightBar) last.rightBar = "|]";
    }
    // inicio de repetición
    for (let i = 0; i < measures.length; i++) {
      const m = measures[i];
      const prevBar = i > 0 ? measures[i - 1].rightBar : null;
      m.startRepeat = m.leftBar === "|:" || prevBar === "|:" || prevBar === ":|:";
    }
    // empates hacia el compás siguiente
    for (let i = 1; i < measures.length; i++) {
      if (measures[i].tieIn) {
        const p = measures[i - 1];
        if (p.events && p.events.length) {
          const last = [...p.events].reverse().find((e) => e.kind === "note");
          if (last) last.tieOut = true;
        } else if (p.slots) {
          p.tieOutSlot = true;
        }
      }
    }
    // secciones para el mapa
    const sections = measures.filter((m) => m.mark).map((m) => m.mark);
    return { measures, warnings, time: baseTime, sections };
  }

  function interpret(raw, num, time, warnings) {
    const m = {
      num, start: raw.start, end: raw.end, leftBar: raw.leftBar, rightBar: raw.rightBar,
      breakBefore: raw.breakBefore, mark: null, cue: null, dirs: [], volta: null,
      segno: false, coda: false, rest: false, repeat: false, slots: [], rhythm: null,
      stemmed: false, timeChange: false,
    };
    let t = time;
    // figuras con duración: C:2 (blanca), C:1 (redonda), C:4 (negra), C:8 (corchea), C:2. (con puntillo), s:2 (silencio)
    const figs = [];
    let hasDur = false;
    for (const tk of raw.toks) {
      let v = tk.v;
      let dur = null;
      const dm = !tk.grp && v.match(/^(.+):(1|2|4|8)(\.?)$/);
      if (dm) {
        v = dm[1];
        dur = { 1: 8, 2: 4, 4: 2, 8: 1 }[dm[2]] * (dm[3] ? 1.5 : 1);
        if (dur % 1) { warnings.push({ num, msg: `La corchea con puntillo (:8.) no está disponible; usa un corte {…}.` }); dur = 1; }
        hasDur = true;
      }
      if (/^[sS]$/.test(v) && dur) { figs.push({ rest: true, dur }); continue; }
      if (tk.other) { warnings.push({ num, msg: `No entendí el símbolo «${v}».` }); continue; }
      if (v[0] === "[") { m.mark = v.replace(/^\[|\]$/g, "").trim(); continue; }
      if (v[0] === '"' || v[0] === "“") { m.cue = v.replace(/^["“]|["”]$/g, "").trim(); continue; }
      if (v[0] === "(") { m.dirs.push(v.replace(/^\(|\)$/g, "").trim()); continue; }
      if (v[0] === "{") { m.rhythm = v.replace(/^\{|\}$/g, ""); continue; }
      if (/^\d+\.(\d+\.)*$/.test(v)) { m.volta = v; continue; }
      if (/^\d+\/\d+$/.test(v)) { t = parseTime(v); m.timeChange = true; m.time = t; continue; }
      if (/^segno$/i.test(v)) { m.segno = true; continue; }
      if (/^coda$/i.test(v)) { m.coda = true; continue; }
      if (v === "-") { m.rest = true; continue; }
      if (v === "%") { m.repeat = true; continue; }
      if (v === "/" || v === ".") { m.slots.push(null); figs.push({ chord: null, dur }); continue; }
      if (v === "^" ) { const l = m.slots[m.slots.length - 1]; if (l) l.fermata = true; else m.fermataBar = true; continue; }
      const c = parseChord(v);
      if (c) { m.slots.push(c); figs.push({ chord: c, dur }); continue; }
      warnings.push({ num, msg: `No reconozco «${v}» como acorde.` });
    }
    m.time = t;
    if (hasDur && m.rhythm == null) {
      // se convierte en un corte: cada figura sin número dura un tiempo
      const beat = t.compound ? 3 : t.den === 8 ? 1 : 2;
      m.rhythm = figs.map((g) => {
        const d = g.dur || beat;
        return g.rest ? ".".repeat(d) : "o" + "-".repeat(d - 1);
      }).join("");
      m.slots = figs.filter((g) => !g.rest).map((g) => g.chord || null);
      m.figPattern = true;
    }
    if (m.rhythm != null) {
      buildRhythm(m, t, warnings);
    } else if (!m.rest && !m.repeat) {
      const n = m.slots.length;
      const b = t.beats;
      if (n === 0) m.slots = Array(b).fill(null);
      else if (n > b) {
        warnings.push({ num, msg: `Tiene ${n} tiempos y el compás ${t.label} admite ${b}. Usa un corte {…} para figuras más rápidas.` });
        m.slots = m.slots.slice(0, b);
      } else if (n < b) {
        if (b % n === 0) {
          const step = b / n, arr = Array(b).fill(null);
          m.slots.forEach((c, i) => (arr[i * step] = c));
          m.slots = arr;
        } else m.slots = m.slots.concat(Array(b - n).fill(null));
      }
      m.stemmed = b >= 3 && m.slots.every((c) => c);
    }
    return m;
  }

  // ---------- Ritmo en corcheas ----------
  function validDur(start, d, t, rest) {
    const E = t.eighths;
    if (start + d > E) return false;
    if (t.compound) {
      if (d === E) return start === 0;
      if (d === 6) return start % 6 === 0;
      if (d === 3) return start % 3 === 0;
      if (d === 2) return !rest && start % 3 === 0;
      return d === 1;
    }
    if (d === 8) return start === 0 && E === 8;
    if (d === 6) return !rest && (start === 0 || (start === 2 && E === 8));
    if (d === 4) return E === 8 ? start % 4 === 0 : start % 2 === 0;
    if (d === 3) return !rest && start % 2 === 0;
    if (d === 2) return start % 2 === 0;
    return d === 1;
  }
  function splitDur(start, len, t, rest) {
    const out = [];
    const opts = [8, 6, 4, 3, 2, 1];
    while (len > 0) {
      let d = 1;
      for (const o of opts) if (o <= len && validDur(start, o, t, rest)) { d = o; break; }
      out.push({ start, dur: d });
      start += d; len -= d;
    }
    return out;
  }

  function buildRhythm(m, t, warnings) {
    let p = m.rhythm.replace(/\s|\|/g, "").replace(/X/g, "x").replace(/O/g, "o").replace(/_/g, "-").replace(/r/gi, ".");
    const bad = p.replace(/[xo.\-]/g, "");
    if (bad) warnings.push({ num: m.num, msg: `El corte solo usa x (golpe acentuado), o (golpe), - (sostener) y . (silencio).` });
    p = p.replace(/[^xo.\-]/g, "");
    const E = t.eighths;
    if (p.length !== E) {
      warnings.push({ num: m.num, msg: m.figPattern
        ? `Las figuras suman ${p.length / 2} tiempos y el compás ${t.label} lleva ${E / 2}.`
        : `El corte tiene ${p.length} corcheas y el compás ${t.label} lleva ${E}.` });
      p = (p + ".".repeat(E)).slice(0, E);
    }
    const chords = m.figPattern ? m.slots : m.slots.filter(Boolean);
    m.slots = null;
    const evs = [];
    let i = 0, ci = 0;
    if (p[0] === "-") {
      let k = 0; while (p[k] === "-") k++;
      evs.push({ kind: "note", start: 0, len: k, accent: false, chord: null, tieIn: true });
      m.tieIn = true; i = k;
    }
    while (i < E) {
      const ch = p[i];
      if (ch === "x" || ch === "o") {
        let k = i + 1; while (k < E && p[k] === "-") k++;
        evs.push({ kind: "note", start: i, len: k - i, accent: ch === "x", chord: chords[ci++] || null });
        i = k;
      } else if (ch === ".") {
        let k = i + 1; while (k < E && p[k] === ".") k++;
        evs.push({ kind: "rest", start: i, len: k - i });
        i = k;
      } else i++;
    }
    if (ci < chords.length) warnings.push({ num: m.num, msg: `Sobran acordes: hay ${chords.length} y el corte tiene ${ci} golpes.` });
    // dividir en figuras escribibles
    const pieces = [];
    for (const ev of evs) {
      if (ev.kind === "rest") {
        if (ev.len === E) { pieces.push({ kind: "rest", start: 0, dur: E, whole: true }); continue; }
        for (const s of splitDur(ev.start, ev.len, t, true)) pieces.push({ kind: "rest", ...s });
      } else {
        const parts = splitDur(ev.start, ev.len, t, false);
        parts.forEach((s, j) => pieces.push({
          kind: "note", ...s, accent: j === 0 && ev.accent, chord: j === 0 ? ev.chord : null,
          tieOut: j < parts.length - 1, tieIn: j === 0 && ev.tieIn,
        }));
      }
    }
    m.events = pieces;
    m.fermataOnLast = chords.some((c) => c && c.fermata);
  }

  // ---------- Cifrado en pantalla ----------
  function chordParts(c, cifrado) {
    const name = (r) => (cifrado === "lat" ? AM2LAT[r] : r);
    return { root: name(c.root), acc: c.acc, qual: c.qual, bass: c.bass ? { root: name(c.bass.root), acc: c.bass.acc } : null };
  }

  function chordSVG(c, x, y, st, cifrado, size) {
    const f = FAM[st];
    const p = chordParts(c, cifrado);
    const F = size;
    const accT = (a, base) => {
      if (!a) return "";
      const up = a === "#" ? 0.5 : 0.28;
      const fs = (a === "#" ? 0.95 : 1.12) * F * (st === "J" ? 0.85 : 1);
      return `<tspan font-family="${f.mus}" font-size="${fs.toFixed(1)}" dy="${(-up * F).toFixed(1)}" dx="${(0.05 * F).toFixed(1)}">${a === "#" ? G.sharp : G.flat}</tspan><tspan font-size="${base.toFixed(1)}" dy="${(up * F).toFixed(1)}" dx="${(0.04 * F).toFixed(1)}">\u200B</tspan>`;
    };
    let s = `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${f.txt}" font-weight="${f.txtWB}" font-size="${F}" class="ch">`;
    s += `<tspan>${esc(p.root)}</tspan>`;
    s += accT(p.acc, F);
    if (p.qual) {
      const qF = F * 0.74;
      const bits = p.qual.split(/([#b♯♭](?=\d))/);
      for (const b of bits) {
        if (!b) continue;
        if (/^[#b♯♭]$/.test(b)) s += accT(b === "♯" ? "#" : b === "♭" ? "b" : b, qF);
        else s += `<tspan font-size="${qF.toFixed(1)}">${esc(b)}</tspan>`;
      }
    }
    if (p.bass) {
      s += `<tspan font-size="${F}">/${esc(p.bass.root)}</tspan>`;
      s += accT(p.bass.acc, F);
    }
    return s + "</text>";
  }

  function chordText(c, cifrado) {
    const p = chordParts(c, cifrado);
    const a = (x) => (x === "#" ? "♯" : x === "b" ? "♭" : "");
    return p.root + a(p.acc) + p.qual + (p.bass ? "/" + p.bass.root + a(p.bass.acc) : "");
  }

  // ---------- Dibujo ----------
  const PW = 816, PH = 1056, ML = 52, MR = 52, MB = 52;
  const S = 6.8; // espacio de pentagrama en px
  const STEM = 3.5; // largo de plica (espacios) desde el centro

  function render(song, opts = {}) {
    const st = opts.estilo === "C" ? "C" : "J";
    const cif = opts.cifrado === "lat" ? "lat" : "am";
    const f = FAM[st], M = MET[st];
    const parsed = opts.parsed || parse(song);
    const { measures } = parsed;
    const perLine = Math.max(1, Math.min(8, +song.porLinea || 4));
    const fs = 4 * S; // tamaño de fuente musical
    const chordF = st === "J" ? 2.55 * S : 2.5 * S;
    const ks = keyCount(song.tono);
    const accW = (ks >= 0 ? M.sharpW : M.flatW) * S + 0.25 * S;
    const keyW = Math.abs(ks) * accW;
    const clefX = 0.7 * S, keyX = clefX + M.clefW * S + 0.9 * S;
    const tsW = M.tsW * M.tsScale * S + 1.2 * S;
    const W = PW - ML - MR;

    // ---- agrupar en sistemas
    const systems = [];
    let cur = [];
    measures.forEach((m, i) => {
      if (cur.length && (m.breakBefore || cur.length >= perLine)) { systems.push(cur); cur = []; }
      cur.push(m);
    });
    if (cur.length) systems.push(cur);

    // ---- páginas y posiciones verticales
    const pages = [[]];
    const headerH = 168, headerH2 = 70;
    let y = headerH;
    systems.forEach((sys, si) => {
      const hasAbove = sys.some((m) => m.volta || m.dirs.length || m.segno || m.coda);
      const hasBelow = sys.some((m) => m.mark || m.cue);
      const above = (hasAbove ? 7.4 : 4.6) * S;
      const busy = sys.some((m) => m.events || m.stemmed);
      const below = (hasBelow ? (busy ? 8.4 : 6.2) : busy ? 5.2 : 3.6) * S;
      const h = above + 4 * S + below;
      if (y + h > PH - MB && pages[pages.length - 1].length) { pages.push([]); y = headerH2; }
      pages[pages.length - 1].push({ sys, si, top: y + above, h });
      y += h;
    });

    const total = pages.length;
    const allNotes = []; // para ligaduras: {page, sysKey, x, y, tieOut}
    const out = [];
    const hits = [];

    pages.forEach((pg, pi) => {
      let svg = "";
      const pHits = [];
      // encabezado
      if (pi === 0) svg += header(song, parsed, st, cif, f, M);
      else {
        svg += `<text x="${PW / 2}" y="40" text-anchor="middle" font-family="${f.txt}" font-weight="${f.txtWB}" font-size="15">${esc(song.titulo || "Sin título")}</text>`;
        svg += `<text x="${ML}" y="40" font-family="${f.txt}" font-weight="${f.txtWB}" font-size="15">${pi + 1}</text>`;
      }
      if (total > 1) svg += `<text x="${PW / 2}" y="${PH - 24}" text-anchor="middle" font-family="${f.txt}" font-size="11" fill="#555">${pi + 1} / ${total}</text>`;

      pg.forEach(({ sys, si, top }) => {
        const first = si === 0;
        const staffTop = top, mid = top + 2 * S, bot = top + 4 * S;
        const x0 = ML;
        // pentagrama
        for (let l = 0; l < 5; l++) svg += `<line x1="${x0}" x2="${PW - MR}" y1="${(top + l * S).toFixed(2)}" y2="${(top + l * S).toFixed(2)}" stroke="#000" stroke-width="${(0.13 * S).toFixed(2)}"/>`;
        // clave y armadura
        svg += glyph(G.gClef, x0 + clefX, top + 3 * S, f.mus, fs);
        const SH = [0, 1.5, -0.5, 1, 2.5, 0.5, 2], FL = [2, 0.5, 2.5, 1, 3, 1.5, 3.5];
        for (let k = 0; k < Math.abs(ks); k++) {
          const yy = top + (ks > 0 ? SH[k] : FL[k]) * S;
          svg += glyph(ks > 0 ? G.sharp : G.flat, x0 + keyX + k * accW, yy, f.mus, fs);
        }
        let px = x0 + keyX + keyW + 0.8 * S;
        const sysTime = sys[0].time;
        if (first || sys[0].timeChange) {
          svg += timeSig(sysTime, px + 0.2 * S, top, f, M, fs);
          px += tsW;
        }
        // número de compás
        svg += `<text x="${x0}" y="${(bot + 2.6 * S).toFixed(1)}" font-family="${f.txt}" font-size="${(1.55 * S).toFixed(1)}" fill="#000">${sys[0].num}</text>`;
        // anchos
        const isLast = si === systems.length - 1;
        const slots = isLast && sys.length < perLine && !sys.some((m) => m.breakBefore && m !== sys[0]) ? perLine : sys.length;
        const avail = PW - MR - px;
        const mw = avail / Math.max(slots, sys.length);
        // barra inicial del sistema
        svg += `<line x1="${x0}" x2="${x0}" y1="${top}" y2="${bot}" stroke="#000" stroke-width="${(0.16 * S).toFixed(2)}"/>`;

        let mx = px;
        const sysNotes = [];
        sys.forEach((m, mi) => {
          const left = mx, right = mx + mw;
          let cx = left + 1.3 * S;
          if (m.startRepeat) {
            svg += barline(mi === 0 ? left : left, top, "start", S);
            cx += 1.6 * S;
          }
          if (m.timeChange && mi > 0) {
            svg += timeSig(m.time, cx, top, f, M, fs);
            cx += tsW;
          }
          const cw = right - 1.0 * S - cx;
          // volta
          if (m.volta) {
            const prev = mi > 0 ? sys[mi - 1] : null;
            const next = sys[mi + 1];
            const startHere = !prev || prev.volta !== m.volta;
            const endHere = !next || next.volta !== m.volta;
            const vy = top - 6.4 * S;
            const vx1 = left + (startHere ? 0.4 * S : 0), vx2 = right - (endHere ? 0.6 * S : 0);
            svg += `<path d="M${vx1.toFixed(1)} ${(vy + (startHere ? 2.4 * S : 0)).toFixed(1)} L${vx1.toFixed(1)} ${vy.toFixed(1)} L${vx2.toFixed(1)} ${vy.toFixed(1)}${endHere && /:\|/.test(m.rightBar) ? ` L${vx2.toFixed(1)} ${(vy + 2.4 * S).toFixed(1)}` : ""}" fill="none" stroke="#000" stroke-width="${(0.16 * S).toFixed(2)}"/>`;
            if (startHere) svg += `<text x="${(vx1 + 0.6 * S).toFixed(1)}" y="${(vy + 1.9 * S).toFixed(1)}" font-family="${f.txt}" font-weight="${f.txtWB}" font-size="${(1.7 * S).toFixed(1)}">${esc(m.volta)}</text>`;
          }
          // segno / coda / textos
          let ax = left + 0.5 * S;
          if (m.segno) { svg += glyph(G.segno, ax, top - 3.6 * S, f.mus, fs * 0.8); ax += M.segnoW * S * 0.8 + 0.8 * S; }
          if (m.coda) { svg += glyph(G.coda, ax, top - 3.6 * S, f.mus, fs * 0.75); ax += M.codaW * S * 0.75 + 0.8 * S; }
          if (m.dirs.length) {
            const txt = m.dirs.join("  ");
            svg += `<text x="${(right - 0.6 * S).toFixed(1)}" y="${(top - 4.2 * S).toFixed(1)}" text-anchor="end" font-family="${f.txt}" font-weight="${f.txtWB}" font-size="${(1.8 * S).toFixed(1)}" font-style="${st === "C" ? "italic" : "normal"}">${esc(txt)}</text>`;
          }
          // marca de ensayo y pista de letra (debajo)
          let bx = mi === 0 ? Math.max(left + 0.3 * S, x0 + textW(String(m.num), f.txt, 1.55 * S) + 1.2 * S) : left + 0.3 * S;
          const busyBelow = !!(m.events || m.stemmed);
          const markDy = busyBelow ? 2.3 * S : 0;
          if (m.mark) {
            const mF = 2.0 * S;
            const tw = textW(m.mark, f.txt, mF, f.txtWB);
            const by = bot + 1.4 * S + markDy, bh = 2.9 * S;
            svg += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${(tw + 1.2 * S).toFixed(1)}" height="${bh.toFixed(1)}" fill="#fff" stroke="#000" stroke-width="${(0.2 * S).toFixed(2)}"/>`;
            svg += `<text x="${(bx + 0.6 * S).toFixed(1)}" y="${(by + bh - 0.75 * S).toFixed(1)}" font-family="${f.txt}" font-weight="${f.txtWB}" font-size="${mF.toFixed(1)}">${esc(m.mark)}</text>`;
            bx += tw + 2.0 * S;
          }
          if (m.cue) {
            svg += `<text x="${bx.toFixed(1)}" y="${(bot + 3.75 * S + markDy).toFixed(1)}" font-family="${f.txt}" font-size="${(1.75 * S).toFixed(1)}" font-style="italic" fill="#222">${esc(m.cue)}</text>`;
          }
          const chordY = top - 1.3 * S;

          // contenido
          if (m.rest) {
            svg += glyph(G.restWhole, left + mw / 2 - (M.restWholeW * S) / 2, top + S, f.mus, fs);
            m.slots = [];
          } else if (m.repeat) {
            svg += glyph(G.rep1, left + mw / 2 - (M.rep1W * S) / 2, mid, f.mus, fs);
          } else if (m.events) {
            const E = m.time.eighths;
            const step = cw / E;
            const placed = [];
            for (const ev of m.events) {
              const x = cx + ev.start * step;
              if (ev.kind === "rest") {
                if (ev.whole) { svg += glyph(G.restWhole, left + mw / 2 - (M.restWholeW * S) / 2, top + S, f.mus, fs); continue; }
                const g = ev.dur >= 8 ? G.restWhole : ev.dur >= 4 ? G.restHalf : ev.dur >= 2 ? G.restQuarter : G.rest8;
                svg += glyph(g, x + 0.2 * S, ev.dur >= 8 ? top + S : mid, f.mus, fs);
                if (ev.dur === 3 || ev.dur === 6) svg += glyph(G.dot, x + 1.6 * S, mid - 0.5 * S, f.mus, fs);
                continue;
              }
              const long = ev.dur >= 4;
              const n = { x, ev, headW: long ? 2.16 * S : M.slashW * S };
              placed.push(n);
              // blanca y redonda: rombo (como en las guías del coro); negra y corchea: slash
              if (long) svg += glyph(ev.dur >= 8 ? G.diamondWhole : G.diamondHalf, x, mid, f.mus, fs * 2);
              else svg += glyph(G.slash, x, mid, f.mus, fs);
              if (ev.dur < 8) {
                n.stemX = x + (long ? 0.1 : 0.07) * S; n.stemEnd = mid + STEM * S;
                svg += stemDown(n.stemX, mid + (long ? 0.1 : 0.9) * S, n.stemEnd, S);
              }
              if (ev.dur === 3 || ev.dur === 6) svg += glyph(G.dot, x + n.headW + 0.45 * S, mid - 0.5 * S, f.mus, fs);
              if (ev.accent) svg += glyph(G.accentBelow, x + 0.07 * S - (M.accentW * S) / 2, mid + (STEM + 0.8) * S, f.mus, fs);
              if (ev.chord) {
                svg += chordSVG(ev.chord, x, chordY, st, cif, chordF);
                if (ev.chord.fermata) svg += glyph(G.fermata, x + n.headW / 2 - (M.fermataW * S) / 2, top - 4.1 * S, f.mus, fs);
              }
              sysNotes.push({ x, w: n.headW, tieOut: ev.tieOut, m });
            }
            // corcheas: barras o banderas
            const grp = m.time.group;
            let i = 0;
            while (i < placed.length) {
              const a = placed[i];
              if (a.ev.dur !== 1) { i++; continue; }
              const g = Math.floor(a.ev.start / grp);
              let j = i;
              while (j + 1 < placed.length && placed[j + 1].ev.dur === 1 && Math.floor(placed[j + 1].ev.start / grp) === g && placed[j + 1].ev.start === placed[j].ev.start + 1) j++;
              if (j > i) {
                const xa = placed[i].stemX - 0.07 * S, xb = placed[j].stemX + 0.07 * S, yb = placed[i].stemEnd;
                svg += `<rect x="${xa.toFixed(1)}" y="${(yb - 0.5 * S).toFixed(1)}" width="${(xb - xa).toFixed(1)}" height="${(0.5 * S).toFixed(1)}" fill="#000"/>`;
              } else {
                svg += glyph(G.flag8Down, a.stemX - 0.07 * S, a.stemEnd, f.mus, fs);
              }
              i = j + 1;
            }
          } else {
            const b = m.slots.length;
            const step = cw / b;
            for (let k = 0; k < b; k++) {
              const c = m.slots[k];
              const x = cx + k * step;
              const restEmpty = m.slots.slice(k + 1).every((z) => !z);
              if (c && c.hold && restEmpty && (k === 0 || (b - k) * 2 >= b)) {
                // acorde sostenido: rombo grande (redonda) o rombo blanco con plica (blanca)
                const whole = k === 0;
                svg += glyph(whole ? G.diamondWhole : G.diamondHalf, x, mid, f.mus, fs * 2);
                const hw = 2.16 * S;
                if (!whole) svg += stemDown(x + 0.1 * S, mid + 0.1 * S, mid + STEM * S, S);
                svg += chordSVG(c, x, chordY, st, cif, chordF);
                if (c.fermata) svg += glyph(G.fermata, x + hw / 2 - (M.fermataW * S) / 2, top - 4.1 * S, f.mus, fs);
                sysNotes.push({ x, w: hw, tieOut: m.tieOutSlot, m });
                break;
              }
              svg += glyph(G.slash, x, mid, f.mus, fs);
              if (m.stemmed) svg += stemDown(x + 0.07 * S, mid + 0.9 * S, mid + STEM * S, S);
              if (c) {
                svg += chordSVG(c, x, chordY, st, cif, chordF);
                if (c.fermata) svg += glyph(G.fermata, x + (M.slashW * S) / 2 - (M.fermataW * S) / 2, top - 4.1 * S, f.mus, fs);
              }
              if (k === b - 1) sysNotes.push({ x, w: M.slashW * S, tieOut: m.tieOutSlot, m });
            }
          }
          if (m.fermataBar) svg += glyph(G.fermata, left + mw / 2 - (M.fermataW * S) / 2, top - 4.1 * S, f.mus, fs);

          // barra final del compás
          const rb = m.rightBar || "|";
          const lastInSys = mi === sys.length - 1;
          let kind = "single";
          if (rb === "||") kind = "double";
          else if (rb === "|]") kind = "final";
          else if (rb === ":|") kind = "end";
          else if (rb === ":|:") kind = "end"; // el inicio se dibuja en el compás siguiente
          else if (rb === "|:") kind = "single";
          svg += barline(right, top, kind, S);

          pHits.push({ num: m.num, start: m.start, end: m.end, x: left, y: top - 6.5 * S, w: mw, h: 12.5 * S });
          mx = right;
        });
        // ligaduras dentro del sistema y hacia el siguiente
        for (let k = 0; k < sysNotes.length; k++) {
          const n = sysNotes[k];
          if (!n.tieOut) continue;
          const nx = sysNotes[k + 1];
          const x1 = n.x + n.w * 0.75, ty = mid - 1.3 * S;
          const x2 = nx ? nx.x + nx.w * 0.3 : PW - MR + 0.5 * S;
          svg += tie(x1, x2, ty, S);
        }
        if (allNotes.pendingTie && sysNotes.length) {
          const nx = sysNotes[0];
          svg += tie(px - 0.5 * S, nx.x + nx.w * 0.3, mid - 1.3 * S, S);
        }
        allNotes.pendingTie = sysNotes.length && sysNotes[sysNotes.length - 1].tieOut;
      });
      out.push(svg);
      hits.push(pHits);
    });

    return { pages: out, hits, parsed, width: PW, height: PH, estilo: st };
  }

  function glyph(ch, x, y, fam, size) {
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${fam}" font-size="${size.toFixed(1)}">${ch}</text>`;
  }
  function tie(x1, x2, y, S) {
    // ligadura hacia arriba (las plicas van hacia abajo)
    const h = Math.min(1.7 * S, 0.8 * S + (x2 - x1) * 0.035);
    const mx = (x1 + x2) / 2;
    return `<path d="M${x1.toFixed(1)} ${y.toFixed(1)} Q${mx.toFixed(1)} ${(y - h * 1.3).toFixed(1)} ${x2.toFixed(1)} ${y.toFixed(1)} Q${mx.toFixed(1)} ${(y - h * 1.3 + 0.5 * S).toFixed(1)} ${x1.toFixed(1)} ${y.toFixed(1)}Z" fill="#000"/>`;
  }
  function stemDown(x, y1, y2, S) {
    return `<rect x="${(x - 0.07 * S).toFixed(2)}" y="${y1.toFixed(1)}" width="${(0.14 * S).toFixed(2)}" height="${(y2 - y1).toFixed(1)}" fill="#000"/>`;
  }
  function barline(x, top, kind, S) {
    const bot = top + 4 * S, thin = 0.16 * S, thick = 0.55 * S;
    const L = (xx, w) => `<rect x="${(xx - w / 2).toFixed(2)}" y="${top.toFixed(1)}" width="${w.toFixed(2)}" height="${(4 * S).toFixed(1)}" fill="#000"/>`;
    const dots = (xx) => `<circle cx="${xx.toFixed(1)}" cy="${(top + 1.5 * S).toFixed(1)}" r="${(0.24 * S).toFixed(2)}"/><circle cx="${xx.toFixed(1)}" cy="${(top + 2.5 * S).toFixed(1)}" r="${(0.24 * S).toFixed(2)}"/>`;
    if (kind === "single") return L(x, thin);
    if (kind === "double") return L(x - 0.5 * S, thin) + L(x, thin);
    if (kind === "final") return L(x - 0.75 * S, thin) + L(x - thick / 2, thick);
    if (kind === "end") return dots(x - 1.45 * S) + L(x - 0.75 * S, thin) + L(x - thick / 2, thick);
    if (kind === "start") return L(x + thick / 2, thick) + L(x + 0.75 * S, thin) + dots(x + 1.45 * S);
    return "";
  }
  function timeSig(t, x, top, f, M, fs) {
    const sc = fs * M.tsScale;
    const num = String(t.num), den = String(t.den);
    const g = (str, y) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${f.mus}" font-size="${sc.toFixed(1)}">${[...str].map(tsDigit).join("")}</text>`;
    return g(num, top + S) + g(den, top + 3 * S);
  }

  function header(song, parsed, st, cif, f, M) {
    let s = "";
    const T = f.txt, B = f.txtWB;
    const title = song.titulo || "Sin título";
    let tF = 34;
    while (tF > 18 && textW(title, T, tF, B) > PW - 2 * ML - 260) tF -= 1;
    if (song.instrumento) s += `<text x="${ML}" y="58" font-family="${T}" font-weight="${B}" font-size="20">${esc(song.instrumento)}</text>`;
    s += `<text x="${PW / 2}" y="62" text-anchor="middle" font-family="${T}" font-weight="${B}" font-size="${tF}">${esc(title)}</text>`;
    if (song.subtitulo) s += `<text x="${PW / 2}" y="84" text-anchor="middle" font-family="${T}" font-weight="${B}" font-size="14">${esc(song.subtitulo)}</text>`;
    if (song.autor) s += `<text x="${PW - MR}" y="84" text-anchor="end" font-family="${T}" font-weight="${B}" font-size="13">${esc(song.autor)}</text>`;
    // fila de datos
    const parts = [];
    if (song.tono) {
      const c = parseChord(String(song.tono).trim().split(/\s+/)[0]);
      parts.push("Tono: " + (c ? chordText(c, cif) : song.tono) + (/menor/i.test(song.tono) ? " menor" : ""));
    }
    parts.push("Compás " + parsed.time.label);
    if (song.estilo) parts.push(song.estilo);
    let x = ML;
    const y = 116;
    if (song.bpm) {
      s += glyph(G.metQ, x, y, f.mus, 4 * S * 0.9);
      x += 1.5 * S + 4;
      const bt = `= ${song.bpm}`;
      s += `<text x="${x}" y="${y}" font-family="${T}" font-weight="${B}" font-size="14">${esc(bt)}</text>`;
      x += textW(bt, T, 14, B) + 22;
    }
    const info = parts.join("   ·   ");
    s += `<text x="${x}" y="${y}" font-family="${T}" font-size="14" font-weight="${f.txtW}">${esc(info)}</text>`;
    // mapa
    const mapa = (song.mapa && song.mapa.trim()) || autoMap(parsed.sections);
    if (mapa) {
      const label = "Mapa:  ";
      const lw = textW(label, T, 13, B);
      s += `<text x="${ML}" y="140" font-family="${T}" font-weight="${B}" font-size="13">${label}</text>`;
      const lines = wrap(mapa, T, 13, f.txtW, PW - ML - MR - lw);
      lines.slice(0, 2).forEach((ln, i) => {
        s += `<text x="${ML + lw}" y="${140 + i * 16}" font-family="${T}" font-weight="${f.txtW}" font-size="13">${esc(ln)}</text>`;
      });
    }
    return s;
  }
  function autoMap(secs) {
    const out = [];
    for (const s of secs) if (out[out.length - 1] !== s) out.push(s);
    return out.join(" – ");
  }
  function wrap(text, fam, size, w, maxW) {
    const words = text.split(/\s+/);
    const lines = [];
    let cur = "";
    for (const wd of words) {
      const t = cur ? cur + " " + wd : wd;
      if (textW(t, fam, size, w) > maxW && cur) { lines.push(cur); cur = wd; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function pageSVG(inner, { embedFonts = false, extra = "" } = {}) {
    const style = embedFonts ? `<style>${fontFaceCSS()}</style>` : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PW} ${PH}" width="${PW}" height="${PH}">${style}<rect width="${PW}" height="${PH}" fill="#fff"/>${inner}${extra}</svg>`;
  }

  return { parse, render, pageSVG, fontFaceCSS, parseChord, chordText, autoMap, keyCount, parseTime, PW, PH };
})();
