/* Portal público del índice UV — FPUNA
 * Lee data/data.json (publicado por el servidor cada export_interval_minutes) y dibuja
 * todo del lado del navegador, sin dependencias externas.
 */
(() => {
  "use strict";

  const CONFIG = {
    dataUrl: "data/data.json",
    refreshMs: 5 * 60 * 1000,
    ozoneDU: 280, // columna de ozono típica para el modelo de cielo despejado
    defaultIntervalMin: 10,
    defaultExportMin: 10,
    // Ventana de medición si data.json no trae measurement_windows
    defaultWindow: { start: "06:00", end: "20:30" },
  };

  // Escala de la OMS
  const LEVELS = [
    {
      key: "low", name: "Bajo", min: 0, max: 2, range: "0 a 2",
      color: "#289500", fg: "#ffffff",
      advice: "No hace falta protección especial. Para estadías largas al aire libre, conviene usar gafas de sol.",
      guide: "Riesgo mínimo para la mayoría de las personas. Usar gafas de sol en días muy luminosos y protector solar si la piel es muy sensible.",
    },
    {
      key: "mod", name: "Moderado", min: 3, max: 5, range: "3 a 5",
      color: "#f7e400", fg: "#2b2600",
      advice: "Buscar sombra en las horas centrales del día. Usar sombrero, gafas de sol y protector solar FPS 30 o más.",
      guide: "Riesgo moderado de quemadura sin protección. Buscar sombra cerca del mediodía, cubrirse con ropa y sombrero, y aplicar protector solar.",
    },
    {
      key: "high", name: "Alto", min: 6, max: 7, range: "6 a 7",
      color: "#f85900", fg: "#ffffff",
      advice: "Reducir el tiempo al sol en las horas centrales. Protector solar FPS 30 o más cada 2 horas, sombrero de ala ancha, ropa que cubra y gafas con filtro UV.",
      guide: "Riesgo alto. Reducir la exposición en las horas centrales del día, usar protección completa y reaplicar el protector solar cada 2 horas.",
    },
    {
      key: "vhigh", name: "Muy alto", min: 8, max: 10, range: "8 a 10",
      color: "#d8001d", fg: "#ffffff",
      advice: "Evitar el sol en las horas centrales. Protección completa: sombra, ropa, sombrero, gafas y protector solar FPS 50 o más.",
      guide: "Riesgo muy alto: la piel sin protección puede quemarse en poco tiempo. Evitar el sol en las horas centrales y extremar la protección.",
    },
    {
      key: "ext", name: "Extremo", min: 11, max: 99, range: "11 o más",
      color: "#6b49c8", fg: "#ffffff",
      advice: "Evitar la exposición al sol. Si es inevitable, usar protección completa y reaplicar protector solar con frecuencia: la piel sin protección se quema en pocos minutos.",
      guide: "Riesgo extremo: la piel sin protección se quema en pocos minutos. Evitar estar al sol y, si no es posible, usar todas las medidas de protección.",
    },
  ];
  const NO_LEVEL = { key: "none", name: "Sin datos", color: "#8a99ab", fg: "#ffffff", advice: "" };

  const $ = (id) => document.getElementById(id);
  const svgNS = "http://www.w3.org/2000/svg";

  const state = {
    data: null,
    days: new Map(),
    dayKeys: [],
    selected: null,
    followToday: true,
    error: false,
  };

  /* ---------------- Utilidades ---------------- */

  const nf1 = new Intl.NumberFormat("es-PY", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 });
  const fmtUvi = (v) => nf1.format(v);

  function levelOf(uvi) {
    if (uvi === null || uvi === undefined || Number.isNaN(uvi)) return NO_LEVEL;
    if (uvi < 3) return LEVELS[0];
    if (uvi < 6) return LEVELS[1];
    if (uvi < 8) return LEVELS[2];
    if (uvi < 11) return LEVELS[3];
    return LEVELS[4];
  }

  const pad = (n) => String(n).padStart(2, "0");
  const hm = (minute) => {
    const m = Math.round(minute);
    return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
  };

  function duration(minutes) {
    const m = Math.round(minutes);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
  }

  function offsetMin() {
    return state.data ? state.data.utc_offset_minutes : -180;
  }

  // Fecha y minuto del día en hora local de la estación
  function localParts(ms) {
    const d = new Date(ms + offsetMin() * 60000);
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    return { date, minute: d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 };
  }

  function dateFromKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  const fmtLong = new Intl.DateTimeFormat("es-PY", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const fmtShort = new Intl.DateTimeFormat("es-PY", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const fmtDM = new Intl.DateTimeFormat("es-PY", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

  function shiftKey(key, days) {
    const d = dateFromKey(key);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function refNow() {
    // Con datos de demostración, "ahora" es el momento de generación del archivo
    const d = state.data;
    if (d && d.is_sample) return Date.parse(d.generated_at);
    return Date.now();
  }

  function stamp(ms) {
    const p = localParts(ms);
    const [, m, d] = p.date.split("-");
    return `${d}/${m} ${hm(p.minute)}`;
  }

  /* ---------------- Modelo solar ---------------- */

  function dayOfYear(key) {
    const d = dateFromKey(key);
    return Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000);
  }

  // Coseno del ángulo cenital (algoritmo simplificado de la NOAA)
  function cosZenith(key, minuteLocal) {
    const st = state.data.station;
    const off = offsetMin();
    const hourUtc = (minuteLocal - off) / 60;
    const g = (2 * Math.PI / 365) * (dayOfYear(key) - 1 + (hourUtc - 12) / 24);
    const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
      - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
      - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
      - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const tst = minuteLocal + eot + 4 * st.longitude - off;
    const ha = ((tst / 4) - 180) * Math.PI / 180;
    const lat = st.latitude * Math.PI / 180;
    return Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  }

  const elevationDeg = (key, minute) => Math.asin(Math.max(-1, Math.min(1, cosZenith(key, minute)))) * 180 / Math.PI;

  // Índice UV con cielo despejado (aproximación de Madronich)
  function clearSkyUvi(key, minute) {
    const mu = cosZenith(key, minute);
    if (mu <= 0) return 0;
    return 12.5 * Math.pow(mu, 2.42) * Math.pow(CONFIG.ozoneDU / 300, -1.23);
  }

  const sunCache = new Map();
  function sunTimes(key) {
    if (sunCache.has(key)) return sunCache.get(key);
    let rise = null;
    let set = null;
    let noon = 0;
    let maxEl = -90;
    for (let m = 0; m < 1440; m += 1) {
      const el = elevationDeg(key, m);
      if (el > -0.833) {
        if (rise === null) rise = m;
        set = m;
      }
      if (el > maxEl) {
        maxEl = el;
        noon = m;
      }
    }
    const r = { rise: rise ?? 360, set: set ?? 1080, noon, maxEl };
    sunCache.set(key, r);
    return r;
  }

  /* ---------------- Análisis de un día ---------------- */

  function intervalMin() {
    return (state.data && state.data.measurement_interval_minutes) || CONFIG.defaultIntervalMin;
  }

  const hmToMin = (text) => {
    const [h, m] = text.split(":").map(Number);
    return h * 60 + m;
  };

  // Ventana de medición vigente en la fecha key (la última con from <= key)
  function windowFor(key) {
    let w = CONFIG.defaultWindow;
    const list = (state.data && state.data.measurement_windows) || [];
    for (const item of [...list].sort((p, q) => p.from.localeCompare(q.from))) {
      if (item.from <= key) w = item;
    }
    return { start: hmToMin(w.start), end: hmToMin(w.end) };
  }

  // Ciclo de medición más cercano al minuto m
  function cycleOf(m, step) {
    return Math.round(m / step) * step;
  }

  function analyze(key) {
    const day = state.days.get(key);
    const series = day ? day.series : [];
    const step = intervalMin();
    const sun = sunTimes(key);
    const win = windowFor(key);
    let max = null;
    let minutesHigh = 0;
    const received = new Set();

    for (const [m, uvi] of series) {
      if (uvi === null) continue;
      if (max === null || uvi > max[1]) max = [m, uvi];
      if (uvi >= 6) minutesHigh += step;
      // Las lecturas fuera de la ventana de operación se grafican pero no cuentan como recibidas
      if (m >= win.start && m <= win.end) received.add(cycleOf(m, step));
    }

    const now = localParts(refNow());
    const end = key === now.date ? Math.min(now.minute, win.end) : win.end;
    const expected = end < win.start ? 0 : Math.floor((end - win.start) / step) + 1;
    const coverage = expected > 0 ? Math.min(1, received.size / expected) : null;

    return { series, max, minutesHigh, coverage, sun, step, win };
  }

  function riskWindow(key, threshold) {
    let first = null;
    let last = null;
    for (let m = 0; m < 1440; m += 1) {
      if (clearSkyUvi(key, m) >= threshold) {
        if (first === null) first = m;
        last = m;
      }
    }
    return first === null ? null : { first, last };
  }

  /* ---------------- Carga de datos ---------------- */

  async function load() {
    try {
      const res = await fetch(`${CONFIG.dataUrl}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      ingest(data);
      state.error = false;
    } catch (err) {
      console.error("No se pudieron cargar los datos", err);
      state.error = true;
    }
    renderAll();
  }

  function ingest(data) {
    state.data = data;
    state.days = new Map((data.days || []).map((d) => [d.date, d]));
    state.dayKeys = [...state.days.keys()].sort();
    const today = localParts(refNow()).date;
    if (state.followToday || !state.days.has(state.selected)) {
      state.selected = state.days.has(today) ? today : state.dayKeys[state.dayKeys.length - 1] || today;
    }
  }

  /* ---------------- Renderizado ---------------- */

  function renderAll() {
    renderStatus();
    if (!state.data) {
      $("now-advice").textContent = "No se pudieron cargar las mediciones. La página vuelve a intentarlo cada 5 minutos.";
      return;
    }
    $("demo-banner").hidden = !state.data.is_sample;
    if (state.data.station && state.data.station.place) {
      $("station-place").textContent = state.data.station.place;
    }
    renderNow();
    renderArc();
    renderRuler();
    renderRiskWindow();
    renderDayPicker();
    renderDay();
    renderHistory();
    renderGuide();
    renderSpecs();
    renderDataInfo();
  }

  function renderDataInfo() {
    for (const el of document.querySelectorAll(".js-interval")) el.textContent = intervalMin();
    const exportMin = state.data.export_interval_minutes || CONFIG.defaultExportMin;
    for (const el of document.querySelectorAll(".js-export-interval")) el.textContent = exportMin;
    const version = state.data.calibration_version;
    $("calibration").hidden = !version;
    $("calibration-version").textContent = version || "";
  }

  function isStale() {
    const c = state.data && state.data.current;
    if (!c) return true;
    const age = refNow() - Date.parse(c.measured_at);
    return age > (state.data.stale_after_minutes || 30) * 60000;
  }

  function renderStatus() {
    const el = $("status");
    const text = el.querySelector(".status__text");
    if (state.error && !state.data) {
      el.dataset.state = "error";
      text.textContent = "Sin conexión con los datos";
      return;
    }
    const updated = stamp(Date.parse(state.data.generated_at)).split(" ")[1];
    if (isStale()) {
      el.dataset.state = "stale";
      text.textContent = `Sin datos recientes, publicado ${updated}`;
    } else {
      el.dataset.state = "live";
      text.textContent = `En línea, actualizado ${updated}`;
    }
  }

  function renderNow() {
    const c = state.data.current;
    const stale = isStale();
    const reading = $("reading");
    const valueEl = $("reading-value");
    const now = localParts(refNow());
    const sun = sunTimes(now.date);
    const isNight = now.minute < sun.rise || now.minute > sun.set;

    reading.dataset.stale = String(stale);

    if (!c) {
      valueEl.textContent = "--";
      $("reading-level").textContent = "Sin datos";
      $("reading-time").textContent = "La estación todavía no envió mediciones.";
      $("now-advice").textContent = "";
    } else {
      const lvl = levelOf(c.uv_index);
      valueEl.textContent = fmtUvi(c.uv_index);
      valueEl.style.setProperty("--level-bg", stale ? NO_LEVEL.color : lvl.color);
      valueEl.style.setProperty("--level-fg", stale ? NO_LEVEL.fg : lvl.fg);
      if (stale) {
        $("reading-level").textContent = "Sin datos recientes";
        $("reading-time").textContent = `Última medición recibida el ${stamp(Date.parse(c.measured_at))}. La estación puede estar fuera de servicio.`;
        $("now-advice").textContent = "Mientras no haya datos nuevos, tomar como referencia la guía de protección y el horario de riesgo estimado para hoy.";
      } else {
        $("reading-level").textContent = lvl.name;
        $("reading-time").textContent = `Medido a las ${stamp(Date.parse(c.measured_at)).split(" ")[1]}`;
        $("now-advice").textContent = isNight && c.uv_index === 0
          ? "El sol está bajo el horizonte: no hay radiación UV en este momento."
          : lvl.advice;
      }
    }

    const today = analyze(now.date);
    const facts = [];
    facts.push(["Máximo de hoy", today.max ? `${fmtUvi(today.max[1])} <small>a las ${hm(today.max[0])}</small>` : "--"]);
    facts.push(["Intensidad UV", c && !stale && c.uv_intensity !== null ? `${nf2.format(c.uv_intensity)} mW/cm²` : "--"]);
    const el = elevationDeg(now.date, now.minute);
    facts.push(["Altura del sol", el > 0 ? `${nf0.format(el)}°` : "Bajo el horizonte"]);

    const dl = $("now-facts");
    dl.replaceChildren(...facts.map(([k, v]) => {
      const div = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = k;
      dd.innerHTML = v;
      div.append(dt, dd);
      return div;
    }));
  }

  function svg(tag, attrs = {}, parent = null) {
    const el = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (parent) parent.appendChild(el);
    return el;
  }

  function renderArc() {
    const root = $("arc-svg");
    root.replaceChildren();
    const now = localParts(refNow());
    const key = now.date;
    const sun = sunTimes(key);
    const cx = 260;
    const cy = 238;
    const R = 205;

    const frac = (m) => (m - sun.rise) / (sun.set - sun.rise);
    const pt = (f, r = R) => {
      const th = Math.PI * (1 - f);
      return [cx + r * Math.cos(th), cy - r * Math.sin(th)];
    };
    const arcPath = (f1, f2) => {
      const [x1, y1] = pt(f1);
      const [x2, y2] = pt(f2);
      return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
    };

    svg("path", { d: arcPath(0, 1), class: "track" }, root);

    const day = state.days.get(key);
    if (day) {
      const half = intervalMin() / 2;
      for (const [m, uvi] of day.series) {
        if (m < sun.rise || m > sun.set || uvi === null) continue;
        const f1 = Math.max(0, frac(m - half - 0.4));
        const f2 = Math.min(1, frac(m + half + 0.4));
        svg("path", { d: arcPath(f1, f2), class: "seg", stroke: levelOf(uvi).color }, root);
      }
    }

    svg("line", { x1: cx, y1: cy - R + 14, x2: cx, y2: cy - 122, class: "noon-tick" }, root);
    svg("line", { x1: 14, y1: cy, x2: 506, y2: cy, class: "horizon" }, root);

    const label = (x, y, text, cls, anchor = "middle") => {
      const t = svg("text", { x, y, class: cls, "text-anchor": anchor }, root);
      t.textContent = text;
      return t;
    };

    label(cx - R, cy + 25, "Salida", "lbl");
    label(cx - R, cy + 52, hm(sun.rise), "lbl-strong");
    label(cx + R, cy + 25, "Puesta", "lbl");
    label(cx + R, cy + 52, hm(sun.set), "lbl-strong");
    label(cx, cy + 25, `Mediodía solar, ${nf0.format(sun.maxEl)}° de altura`, "lbl");
    label(cx, cy + 52, hm(sun.noon), "lbl-strong");

    const isDay = now.minute >= sun.rise && now.minute <= sun.set;
    if (isDay) {
      const [sx, sy] = pt(frac(now.minute));
      svg("circle", { cx: sx, cy: sy, r: 24, class: "sun-halo" }, root);
      svg("circle", { cx: sx, cy: sy, r: 12, class: "sun" }, root);

      const cs = clearSkyUvi(key, now.minute);
      label(cx, cy - 98, "Con cielo despejado,", "lbl");
      label(cx, cy - 76, "ahora se esperaría un índice de", "lbl");
      const big = label(cx, cy - 26, fmtUvi(cs), "lbl-strong");
      big.setAttribute("style", "font-size:44px;font-weight:800");
    } else {
      label(cx, cy - 70, "Es de noche:", "lbl");
      label(cx, cy - 50, "el sol está bajo el horizonte", "lbl");
    }
  }

  function renderRuler() {
    const box = $("ruler");
    box.replaceChildren();
    const bar = document.createElement("div");
    bar.className = "ruler__bar";
    const ticks = document.createElement("div");
    ticks.className = "ruler__ticks";
    for (let i = 0; i <= 15; i += 1) {
      bar.appendChild(document.createElement("span"));
      const t = document.createElement("span");
      t.textContent = i === 15 ? "15" : String(i);
      ticks.appendChild(t);
    }
    box.append(bar, ticks);

    const pos = (v) => `${((Math.min(15, Math.max(0, v)) + 0.5) / 16) * 100}%`;
    const c = state.data.current;
    if (c && !isStale()) {
      const mk = document.createElement("div");
      mk.className = "ruler__marker";
      mk.style.left = pos(c.uv_index);
      mk.textContent = `Ahora ${fmtUvi(c.uv_index)}`;
      box.appendChild(mk);
    }
    const today = analyze(localParts(refNow()).date);
    if (today.max) {
      const mx = document.createElement("div");
      mx.className = "ruler__marker ruler__marker--max";
      mx.style.left = pos(today.max[1]);
      mx.textContent = `Máximo de hoy ${fmtUvi(today.max[1])}`;
      box.appendChild(mx);
    }
  }

  function renderRiskWindow() {
    const key = localParts(refNow()).date;
    const win = riskWindow(key, 3);
    const hi = riskWindow(key, 6);
    let text = "";
    if (win) {
      text = `Hoy, con cielo despejado, el índice UV supera el nivel moderado entre las ${hm(win.first)} y las ${hm(win.last)}`;
      text += hi ? `, y llega a nivel alto o más entre las ${hm(hi.first)} y las ${hm(hi.last)}.` : ".";
      text += " En ese horario conviene usar protección aunque el cielo esté nublado.";
    }
    $("risk-window").textContent = text;
  }

  function dayLabel(key, long = false) {
    const today = localParts(refNow()).date;
    const base = (long ? fmtLong : fmtShort).format(dateFromKey(key));
    if (key === today) return `Hoy, ${base}`;
    if (key === shiftKey(today, -1)) return `Ayer, ${base}`;
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  function renderDayPicker() {
    const sel = $("day-select");
    const keys = [...state.dayKeys].reverse();
    sel.replaceChildren(...keys.map((k) => {
      const o = document.createElement("option");
      o.value = k;
      o.textContent = dayLabel(k, true);
      return o;
    }));
    sel.value = state.selected;
    const idx = state.dayKeys.indexOf(state.selected);
    $("day-prev").disabled = idx <= 0;
    $("day-next").disabled = idx === -1 || idx >= state.dayKeys.length - 1;
  }

  function selectDay(key, scroll = false) {
    if (!state.days.has(key)) return;
    state.selected = key;
    state.followToday = key === localParts(refNow()).date;
    renderDayPicker();
    renderDay();
    renderHistory();
    if (scroll) $("dia").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function statItem(label, valueHtml) {
    const div = document.createElement("div");
    div.innerHTML = `<dt>${label}</dt><dd>${valueHtml}</dd>`;
    return div;
  }

  function chipHtml(uvi) {
    const l = levelOf(uvi);
    return `<span class="chip" style="background:${l.color};color:${l.fg}">${fmtUvi(uvi)}</span>`;
  }

  function renderDay() {
    const key = state.selected;
    const a = analyze(key);
    const stats = $("day-stats");
    stats.replaceChildren(
      statItem("Máximo", a.max ? `${chipHtml(a.max[1])} <small>${levelOf(a.max[1]).name.toLowerCase()}</small>` : "--"),
      statItem("Hora del máximo", a.max ? hm(a.max[0]) : "--"),
      statItem("Con UV alto o más", duration(a.minutesHigh)),
      statItem("Datos recibidos", a.coverage === null ? "--" : `${nf0.format(a.coverage * 100)} <small>%</small>`),
    );
    drawDayChart(key, a);
    drawMatrix(key, a);
  }

  /* ---------- Gráfico del día ---------- */

  function hatchDefs(root, id) {
    const defs = svg("defs", {}, root);
    const p = svg("pattern", { id, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
    svg("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "currentColor", "stroke-width": 1.5, opacity: 0.25 }, p);
  }

  function drawDayChart(key, a) {
    const box = $("day-chart");
    box.replaceChildren();
    const W = Math.max(300, box.clientWidth);
    const H = W < 600 ? 250 : 320;
    const M = { l: 30, r: 10, t: 10, b: 28 };
    const pw = W - M.l - M.r;
    const ph = H - M.t - M.b;

    const t0 = Math.min(5 * 60, Math.floor((Math.min(a.sun.rise, a.win.start) - 30) / 60) * 60);
    const t1 = Math.max(21 * 60 + 30, Math.ceil((Math.max(a.sun.set, a.win.end) + 30) / 60) * 60);
    const inWin = a.series.filter(([m]) => m >= t0 && m <= t1);

    let clearMax = 0;
    const clear = [];
    for (let m = t0; m <= t1; m += 5) {
      const v = clearSkyUvi(key, m);
      clear.push([m, v]);
      clearMax = Math.max(clearMax, v);
    }
    const dataMax = a.max ? a.max[1] : 0;
    const yMax = Math.min(16, Math.max(12, Math.ceil(Math.max(dataMax, clearMax)) + 1));

    const x = (m) => M.l + ((m - t0) / (t1 - t0)) * pw;
    const y = (v) => M.t + ph - (v / yMax) * ph;

    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img",
      "aria-label": `Índice UV del ${dayLabel(key, true)}. Máximo ${a.max ? fmtUvi(a.max[1]) : "sin datos"}.` });
    root.style.color = "var(--ink)";
    hatchDefs(root, "hatch-day");

    // Franjas de nivel
    const bands = [[0, 3, 0], [3, 6, 1], [6, 8, 2], [8, 11, 3], [11, yMax, 4]];
    for (const [lo, hi, i] of bands) {
      if (lo >= yMax) continue;
      svg("rect", { x: M.l, y: y(Math.min(hi, yMax)), width: pw, height: y(lo) - y(Math.min(hi, yMax)),
        fill: LEVELS[i].color, class: "band" }, root);
    }

    // Grilla y ejes
    const grid = svg("g", { class: "grid" }, root);
    const axis = svg("g", { class: "axis" }, root);
    for (let v = 0; v <= yMax; v += 2) {
      svg("line", { x1: M.l, x2: M.l + pw, y1: y(v), y2: y(v) }, grid);
      const t = svg("text", { x: M.l - 8, y: y(v) + 4, "text-anchor": "end" }, axis);
      t.textContent = v;
    }
    const hourStep = pw < 520 ? 2 : 1;
    for (let m = t0; m <= t1; m += 60) {
      const hh = m / 60;
      if (hh % hourStep !== 0) continue;
      const t = svg("text", { x: x(m), y: H - 8, "text-anchor": "middle" }, axis);
      t.textContent = pw < 520 ? `${pad(hh)}` : `${pad(hh)}:00`;
    }

    // Huecos sin datos durante el día
    const step = a.step;
    let prev = a.win.start;
    const gaps = [];
    for (const [m] of inWin) {
      if (m < a.win.start || m > a.win.end) continue;
      if (m - prev > step * 3) gaps.push([prev, m]);
      prev = m;
    }
    const today = localParts(refNow());
    const endDay = key === today.date ? Math.min(today.minute, a.win.end) : a.win.end;
    if (endDay - prev > step * 3) gaps.push([prev, endDay]);
    for (const [g0, g1] of gaps) {
      svg("rect", { x: x(g0), y: M.t, width: Math.max(0, x(g1) - x(g0)), height: ph, fill: "url(#hatch-day)" }, root);
    }

    // Barras
    const bw = Math.max(1, (step / (t1 - t0)) * pw - (pw > 700 ? 0.8 : 0.3));
    const bars = svg("g", {}, root);
    for (const [m, uvi, , estado] of inWin) {
      if (!uvi) continue;
      const color = levelOf(uvi).color;
      const est = estado === "estimado" ? { class: "bar-est", stroke: color } : {};
      svg("rect", { x: x(m) - bw / 2, y: y(uvi), width: bw, height: y(0) - y(uvi), fill: color, ...est }, bars);
    }

    // Cielo despejado
    const d = clear.filter(([, v]) => v > 0.02).map(([m, v], i) => `${i ? "L" : "M"}${x(m).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    if (d) svg("path", { d, class: "clear-sky" }, root);

    // Interacción
    const cursor = svg("line", { y1: M.t, y2: M.t + ph, class: "cursor", visibility: "hidden" }, root);
    const hit = svg("rect", { x: M.l, y: M.t, width: pw, height: ph, fill: "transparent" }, root);
    const onMove = (ev) => {
      const r = root.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const m = t0 + ((px - M.l) / pw) * (t1 - t0);
      let best = null;
      for (const row of inWin) if (!best || Math.abs(row[0] - m) < Math.abs(best[0] - m)) best = row;
      if (!best || Math.abs(best[0] - m) > step * 2) {
        cursor.setAttribute("visibility", "hidden");
        showTip(null);
        return;
      }
      cursor.setAttribute("x1", x(best[0]));
      cursor.setAttribute("x2", x(best[0]));
      cursor.setAttribute("visibility", "visible");
      const lv = levelOf(best[1]);
      const cs = clearSkyUvi(key, best[0]);
      showTip(`<strong>${hm(best[0])}</strong><br>Índice UV ${fmtUvi(best[1])}, ${lv.name.toLowerCase()}`
        + (best[2] !== null && best[2] !== undefined ? `<br>Intensidad ${nf2.format(best[2])} mW/cm²` : "")
        + `<br>Cielo despejado: ${nf1.format(cs)}`
        + (best[3] === "estimado" ? "<br>Estimado (sol bajo)" : ""), ev);
    };
    hit.addEventListener("pointermove", onMove);
    hit.addEventListener("pointerdown", onMove);
    hit.addEventListener("pointerleave", () => {
      cursor.setAttribute("visibility", "hidden");
      showTip(null);
    });

    box.appendChild(root);
    box.appendChild(legend(true));
  }

  function legend(withClear) {
    const div = document.createElement("div");
    div.className = "legend";
    const items = LEVELS.map((l) => `<span><i style="background:${l.color}"></i>${l.name}</span>`);
    if (withClear) {
      items.push('<span><i class="dash"></i>Cielo despejado (modelo)</span>');
      items.push('<span><i class="est"></i>Estimado: sol bajo (&lt; 32° de altura), el sensor queda parcialmente en sombra</span>');
    }
    items.push('<span><i style="background:repeating-linear-gradient(45deg,var(--line) 0 2px,transparent 2px 5px);border:1px solid var(--line)"></i>Sin datos</span>');
    div.innerHTML = items.join("");
    return div;
  }

  /* ---------- Tabla del día ---------- */

  function drawMatrix(key, a) {
    const table = $("day-matrix");
    table.replaceChildren();
    const step = a.step;
    const cols = Math.max(1, Math.round(60 / step));
    // Cada lectura va al ciclo más cercano; si dos coinciden, se muestra la mayor
    const byCell = new Map();
    for (const [m, uvi, , estado] of a.series) {
      if (uvi === null || uvi === undefined) continue;
      const c = cycleOf(m, step);
      const prev = byCell.get(c);
      if (!prev || uvi > prev.v) byCell.set(c, { v: uvi, est: estado === "estimado" });
    }
    const h0 = Math.floor(Math.min(a.sun.rise, a.win.start) / 60);
    const h1 = Math.floor(Math.max(a.sun.set, a.win.end) / 60);

    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    hr.innerHTML = `<th scope="col">Hora</th>${Array.from({ length: cols }, (_, i) => `<th scope="col">:${pad(i * step)}</th>`).join("")}<th scope="col" class="col-max">Máx.</th>`;
    thead.appendChild(hr);

    const tbody = document.createElement("tbody");
    for (let h = h0; h <= h1; h += 1) {
      const tr = document.createElement("tr");
      let cells = `<th scope="row">${pad(h)}</th>`;
      let mx = null;
      for (let i = 0; i < cols; i += 1) {
        const cell = byCell.get(h * 60 + i * step);
        if (!cell) {
          cells += '<td class="empty">·</td>';
        } else {
          const l = levelOf(cell.v);
          mx = mx === null ? cell.v : Math.max(mx, cell.v);
          const cls = cell.est ? ' class="is-estimado" title="Estimado: sol bajo"' : "";
          cells += `<td${cls} style="background:${l.color};color:${l.fg}">${fmtUvi(cell.v)}</td>`;
        }
      }
      if (mx === null) cells += '<td class="col-max empty">·</td>';
      else {
        const l = levelOf(mx);
        cells += `<td class="col-max" style="background:${l.color};color:${l.fg}">${fmtUvi(mx)}</td>`;
      }
      tr.innerHTML = cells;
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);
  }

  /* ---------- Historial ---------- */

  function renderHistory() {
    const today = localParts(refNow()).date;
    const keys = Array.from({ length: 30 }, (_, i) => shiftKey(today, i - 29));
    const rows = keys.map((k) => ({ key: k, has: state.days.has(k), a: state.days.has(k) ? analyze(k) : null }));
    drawHistoryChart(rows);

    const tbody = $("history-table").querySelector("tbody");
    tbody.replaceChildren(...[...rows].reverse().map((r) => {
      const tr = document.createElement("tr");
      const date = fmtShort.format(dateFromKey(r.key));
      if (!r.has || !r.a.max) {
        tr.className = "no-data";
        tr.innerHTML = `<td>${date}</td><td colspan="4">Sin datos</td>`;
        return tr;
      }
      const a = r.a;
      tr.tabIndex = 0;
      if (r.key === state.selected) tr.classList.add("is-selected");
      tr.innerHTML = `<td>${date}</td><td>${chipHtml(a.max[1])}</td><td>${hm(a.max[0])}</td>
        <td>${duration(a.minutesHigh)}</td>
        <td>${a.coverage === null ? "--" : `${nf0.format(a.coverage * 100)} %`}</td>`;
      tr.addEventListener("click", () => selectDay(r.key, true));
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectDay(r.key, true);
        }
      });
      return tr;
    }));
  }

  function drawHistoryChart(rows) {
    const box = $("history-chart");
    box.replaceChildren();
    const W = Math.max(300, box.clientWidth);
    const H = W < 600 ? 220 : 260;
    const M = { l: 30, r: 10, t: 22, b: 28 };
    const pw = W - M.l - M.r;
    const ph = H - M.t - M.b;
    const maxVal = Math.max(12, ...rows.filter((r) => r.a && r.a.max).map((r) => r.a.max[1] + 1));
    const yMax = Math.min(16, maxVal);
    const slot = pw / rows.length;
    const bw = Math.max(4, slot * 0.72);
    const y = (v) => M.t + ph - (v / yMax) * ph;

    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img",
      "aria-label": "Índice UV máximo diario de los últimos 30 días" });
    root.style.color = "var(--ink)";
    hatchDefs(root, "hatch-hist");

    const grid = svg("g", { class: "grid" }, root);
    const axis = svg("g", { class: "axis" }, root);
    for (let v = 0; v <= yMax; v += 2) {
      svg("line", { x1: M.l, x2: M.l + pw, y1: y(v), y2: y(v) }, grid);
      const t = svg("text", { x: M.l - 8, y: y(v) + 4, "text-anchor": "end" }, axis);
      t.textContent = v;
    }

    const every = pw < 520 ? 7 : 3;
    rows.forEach((r, i) => {
      const cx = M.l + slot * i + slot / 2;
      if (i % every === (rows.length - 1) % every) {
        const t = svg("text", { x: cx, y: H - 8, "text-anchor": "middle" }, axis);
        t.textContent = fmtDM.format(dateFromKey(r.key));
      }
      if (!r.a || !r.a.max) {
        svg("rect", { x: cx - bw / 2, y: M.t, width: bw, height: ph, fill: "url(#hatch-hist)" }, root);
        return;
      }
      const v = r.a.max[1];
      const g = svg("g", {}, root);
      const hit = svg("rect", { x: M.l + slot * i, y: M.t, width: slot, height: ph, fill: "transparent", class: "bar-hit" }, g);
      svg("rect", { x: cx - bw / 2, y: y(v), width: bw, height: y(0) - y(v), fill: levelOf(v).color, rx: 1.5,
        class: `bar${r.key === state.selected ? " is-selected" : ""}` }, g);
      if (bw >= 16) {
        const t = svg("text", { x: cx, y: y(v) - 5, "text-anchor": "middle", class: "note" }, g);
        t.textContent = fmtUvi(v);
      }
      const tip = (ev) => showTip(`<strong>${dayLabel(r.key, true)}</strong><br>Máximo ${fmtUvi(v)}, ${levelOf(v).name.toLowerCase()}, a las ${hm(r.a.max[0])}`, ev);
      hit.addEventListener("pointermove", tip);
      hit.addEventListener("pointerleave", () => showTip(null));
      hit.addEventListener("click", () => {
        showTip(null);
        selectDay(r.key, true);
      });
    });

    box.appendChild(root);
  }

  /* ---------- Guía y ficha ---------- */

  function renderGuide() {
    const ul = $("guide-list");
    if (ul.childElementCount) return;
    ul.replaceChildren(...LEVELS.map((l) => {
      const li = document.createElement("li");
      li.style.setProperty("--c", l.color);
      li.innerHTML = `<span class="guide__name">${l.name}</span><span class="guide__range">${l.range}</span><p class="guide__text">${l.guide}</p>`;
      return li;
    }));
  }

  function renderSpecs() {
    const d = state.data;
    const st = d.station;
    const items = [
      ["Estación", st.name || st.id],
      ["Ubicación", `${st.place} (aprox. ${nf2.format(st.latitude)}°, ${nf2.format(st.longitude)}°)`],
      ["Sensor", st.sensor],
      ["Magnitud medida", "Intensidad UV de banda ancha (290–390 nm, mW/cm²); el índice UV se calcula a partir de ella"],
      ["Medición", `Cada ${d.measurement_interval_minutes} minutos`],
      ["Transmisión", "Red celular LTE, protocolo MQTT"],
      ["Publicación", `Cada ${d.export_interval_minutes} minutos`],
      ["Hora", `Paraguay (UTC${d.utc_offset_minutes < 0 ? "−" : "+"}${Math.abs(d.utc_offset_minutes / 60)})`],
      ["Última publicación", stamp(Date.parse(d.generated_at))],
    ];
    $("specs").replaceChildren(...items.map(([k, v]) => {
      const div = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = k;
      dd.textContent = v;
      div.append(dt, dd);
      return div;
    }));
  }

  /* ---------- Tooltip ---------- */

  function showTip(html, ev) {
    const tip = $("tooltip");
    if (!html) {
      tip.hidden = true;
      return;
    }
    tip.innerHTML = html;
    tip.hidden = false;
    const pad = 14;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let left = ev.clientX + pad;
    let top = ev.clientY - h - pad;
    if (left + w > window.innerWidth - 8) left = ev.clientX - w - pad;
    if (top < 8) top = ev.clientY + pad;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${top}px`;
  }

  /* ---------- Descarga CSV ---------- */

  function downloadCsv() {
    if (!state.data) return;
    const lines = ["fecha,hora,indice_uv,intensidad_mw_cm2,estado"];
    for (const key of state.dayKeys) {
      for (const [m, uvi, inten, estado] of state.days.get(key).series) {
        lines.push(`${key},${hm(m)},${uvi ?? ""},${inten ?? ""},${estado ?? ""}`);
      }
    }
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `indice-uv-${state.data.station.id}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- Eventos ---------- */

  $("day-select").addEventListener("change", (e) => selectDay(e.target.value));
  $("day-prev").addEventListener("click", () => {
    const i = state.dayKeys.indexOf(state.selected);
    if (i > 0) selectDay(state.dayKeys[i - 1]);
  });
  $("day-next").addEventListener("click", () => {
    const i = state.dayKeys.indexOf(state.selected);
    if (i < state.dayKeys.length - 1) selectDay(state.dayKeys[i + 1]);
  });
  $("download-csv").addEventListener("click", downloadCsv);

  let resizeTimer = null;
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!state.data) return;
      renderDay();
      renderHistory();
    }, 150);
  });

  load();
  setInterval(load, CONFIG.refreshMs);
})();
