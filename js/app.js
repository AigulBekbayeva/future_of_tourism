/* The Future of Tourism — geoportal
   Three maps, one page. Vanilla JS + MapLibre GL (vendored in /lib). */
(function () {
  "use strict";

  // ---------------------------------------------------------------- config
  const SCEN = {
    ssp126: { short: "SSP1-2.6", long: "SSP1-2.6 · strong mitigation" },
    ssp245: { short: "SSP2-4.5", long: "SSP2-4.5 · middle of the road" },
    ssp585: { short: "SSP5-8.5", long: "SSP5-8.5 · very high emissions" }
  };
  const PER = { "2041-2060": "2041–2060", "2081-2100": "2081–2100" };
  const PROFILE = {
    sight: { label: "Sightseeing & city", band: "15–24 °C", short: "sightseeing" },
    beach: { label: "Beach & sun", band: "23–30 °C", short: "beach" }
  };
  const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  const MONTHS_LONG = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const NODATA = "#e4e3dd";
  const LAND = "#ecebe6";
  const OCEAN = "#d9e3e9";

  // sequential blue — comfortable days
  const SEQ_DAYS = {
    breaks: [15, 30, 60, 90, 120, 180, 240],
    colors: ["#f1f0eb", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"],
    ticks: ["0", "15", "30", "60", "90", "120", "180", "240", "365"]
  };
  // diverging red–gray–blue — change in comfortable days
  const DIV_DELTA = {
    breaks: [-60, -30, -10, -3, 3, 10, 30, 60],
    colors: ["#8f1f1f", "#c43c3a", "#e5736b", "#f4b3a9", "#e9e8e2", "#b7d3f6", "#6da7ec", "#2a78d6", "#184f95"],
    ticks: ["", "−60", "−30", "−10", "−3", "+3", "+10", "+30", "+60", ""]
  };
  // sequential red — heat-stress days
  const SEQ_HOT = {
    breaks: [1, 10, 30, 60, 120, 240],
    colors: ["#f1f0eb", "#fbd9d3", "#f6b0a3", "#ec8270", "#d6534a", "#a8302c", "#6e1a1a"],
    ticks: ["0", "1", "10", "30", "60", "120", "240", "365"]
  };
  // sequential orange — tourism dependence
  const SEQ_DEP = {
    gdp: { breaks: [1, 3, 5, 10, 20], ticks: ["0", "1", "3", "5", "10", "20", "75 %"] },
    exp: { breaks: [5, 10, 20, 40, 60], ticks: ["0", "5", "10", "20", "40", "60", "95 %"] },
    colors: ["#fde4d3", "#f9c09d", "#f2955f", "#dc6a2f", "#b04b1b", "#7a3211"]
  };
  // bivariate: rows = dependence (low, medium, high), cols = climate (gain, little change, loss)
  const BIVAR = [
    ["#d4e2f2", "#eceae4", "#f7d6cd"],
    ["#8fb0d8", "#bcb9b0", "#e9917b"],
    ["#2f67aa", "#6b6861", "#b5302a"]
  ];
  const DEP_CUTS = [3, 10];     // % of GDP
  const CLIM_CUT = 5;          // ± days

  // ---------------------------------------------------------------- state
  const state = {
    ch: 1, profile: "sight", scen: "ssp245", per: "2041-2060",
    ind2: "delta", view3: "dep", meas3: "gdp", showPop: true, globe: true,
    sel: null
  };
  let C, ECO, regionsFC, countriesFC, ptsFC, idx = {}, bboxR = {}, bboxC = {};
  let map, hoverKey = null, hoverSrc = null, selSrc = null, selKey = null;

  // ---------------------------------------------------------------- helpers
  const $ = (s, el = document) => el.querySelector(s);
  const fmt0 = v => v == null || isNaN(v) ? "–" : Math.round(v).toLocaleString("en-US");
  const fmt1 = v => v == null || isNaN(v) ? "–" : (Math.round(v * 10) / 10).toLocaleString("en-US");
  const signed = v => v == null || isNaN(v) ? "–" : (v > 0.5 ? "+" : v < -0.5 ? "−" : "±") + Math.abs(Math.round(v));
  const fmtPop = v => v >= 1e9 ? (v / 1e9).toFixed(2) + " bn" : v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + " m" : v >= 1e3 ? Math.round(v / 1e3) + " k" : fmt0(v);
  const fmtUsd = v => v >= 1e12 ? "$" + (v / 1e12).toFixed(1) + " tn" : v >= 1e9 ? "$" + (v / 1e9).toFixed(v >= 1e10 ? 0 : 1) + " bn" : "$" + (v / 1e6).toFixed(0) + " m";
  const classify = (v, breaks) => { let i = 0; while (i < breaks.length && v >= breaks[i]) i++; return i; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const regionLabel = i => C.name[i];
  const regionCountry = i => C.country[i] || (ECO[C.iso[i]] && ECO[C.iso[i]].name) || C.iso[i];
  const futKey = () => state.scen + "_" + state.per;

  // ---------------------------------------------------------------- values
  function regionValue(i) {
    if (state.ch === 1) return C.base[state.profile][i];
    const f = C.fut[futKey()];
    if (state.ind2 === "delta") return f[state.profile][i] - C.base[state.profile][i];
    return f.hot[i];
  }
  function regionColor(i) {
    const v = regionValue(i);
    if (v == null || isNaN(v)) return NODATA;
    if (state.ch === 1) return SEQ_DAYS.colors[classify(v, SEQ_DAYS.breaks)];
    if (state.ind2 === "delta") return DIV_DELTA.colors[classify(v, DIV_DELTA.breaks)];
    return SEQ_HOT.colors[classify(v, SEQ_HOT.breaks)];
  }
  const depValue = e => state.meas3 === "gdp" ? e.rx_gdp : e.rx_exp;
  function climDelta(e) {
    const f = e["any_" + futKey()];
    return f == null || e.any0 == null ? null : f - e.any0;
  }
  function bivarClass(e) {
    const d = e.rx_gdp, c = climDelta(e);
    if (d == null || c == null) return null;
    const r = d < DEP_CUTS[0] ? 0 : d < DEP_CUTS[1] ? 1 : 2;
    const col = c > CLIM_CUT ? 0 : c < -CLIM_CUT ? 2 : 1;
    return [r, col];
  }
  function countryColor(iso) {
    const e = ECO[iso];
    if (!e) return NODATA;
    if (state.view3 === "dep") {
      const v = depValue(e);
      if (v == null) return NODATA;
      return SEQ_DEP.colors[classify(v, SEQ_DEP[state.meas3].breaks)];
    }
    const b = bivarClass(e);
    return b ? BIVAR[b[0]][b[1]] : NODATA;
  }

  // ---------------------------------------------------------------- data load
  async function loadData() {
    const get = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); });
    const [clim, rtopo, ctopo, eco] = await Promise.all([
      get("data/climate.json"), get("data/regions.topo.json"), get("data/countries.topo.json"), get("data/economy.json")
    ]);
    C = clim; ECO = eco;
    C.ids.forEach((id, i) => { idx[id] = i; });
    regionsFC = topojson.feature(rtopo, rtopo.objects[Object.keys(rtopo.objects)[0]]);
    regionsFC.features.forEach(f => { f.properties = { k: f.id }; bboxR[f.id] = bbox(f.geometry); });
    countriesFC = topojson.feature(ctopo, ctopo.objects[Object.keys(ctopo.objects)[0]]);
    countriesFC.features.forEach(f => { f.properties = { k: f.id }; bboxC[f.id] = bbox(f.geometry); });
    ptsFC = { type: "FeatureCollection", features: [] };
    for (const [iso, e] of Object.entries(ECO)) {
      if (e.lx == null) continue;
      ptsFC.features.push({ type: "Feature", properties: { k: iso, pop: e.pop || 0, area: e.area || 0 }, geometry: { type: "Point", coordinates: [e.lx, e.ly] } });
    }
    ptsFC.features.sort((a, b) => b.properties.pop - a.properties.pop); // big circles below small ones
  }
  function bbox(g) {
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90, xs = [];
    const walk = c => { if (typeof c[0] === "number") { xs.push(c[0]); if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1]; } else c.forEach(walk); };
    walk(g.coordinates);
    xs.forEach(x => { if (x < x0) x0 = x; if (x > x1) x1 = x; });
    if (x1 - x0 > 180) { // crosses the antimeridian: use 0..360
      const s = xs.map(x => x < 0 ? x + 360 : x);
      x0 = Math.min(...s); x1 = Math.max(...s);
      if (x1 > 180) { /* keep as is; MapLibre accepts lng > 180 for bounds */ }
    }
    return [[x0, y0], [x1, y1]];
  }

  // ---------------------------------------------------------------- map
  function initMap() {
    const small = window.innerWidth < 860;
    map = new maplibregl.Map({
      container: "map",
      style: {
        version: 8,
        projection: { type: "globe" },
        sources: {},
        layers: [{ id: "ocean", type: "background", paint: { "background-color": OCEAN } }]
      },
      center: HOME[state.ch], zoom: small ? 0.8 : 2.05, minZoom: 0.3, maxZoom: 9,
      attributionControl: { compact: true, customAttribution: "Boundaries: GADM 3.6, Natural Earth · Climate: ERA5 / AREAdata, WorldClim 2.1 · Economy: World Bank WDI" },
      renderWorldCopies: false
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("countries", { type: "geojson", data: countriesFC, promoteId: "k" });
      map.addSource("regions", { type: "geojson", data: regionsFC, promoteId: "k" });
      map.addSource("pts", { type: "geojson", data: ptsFC, promoteId: "k" });

      map.addLayer({ id: "land", type: "fill", source: "countries", paint: { "fill-color": LAND } });
      map.addLayer({ id: "regions-fill", type: "fill", source: "regions",
        paint: { "fill-color": ["coalesce", ["feature-state", "c"], NODATA], "fill-antialias": false } });
      map.addLayer({ id: "regions-line", type: "line", source: "regions",
        paint: { "line-color": "#ffffff", "line-opacity": 0.55,
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.12, 3, 0.4, 6, 0.9] } });
      map.addLayer({ id: "countries-fill", type: "fill", source: "countries",
        layout: { visibility: "none" },
        paint: { "fill-color": ["coalesce", ["feature-state", "c"], NODATA] } });
      map.addLayer({ id: "countries-line", type: "line", source: "countries",
        paint: { "line-color": "#5f5e59", "line-opacity": 0.45,
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.35, 4, 0.8, 7, 1.4] } });
      map.addLayer({ id: "regions-hl", type: "line", source: "regions",
        paint: { "line-color": "#0b0b0b", "line-width": ["case", ["boolean", ["feature-state", "sel"], false], 2.2, 1.4],
          "line-opacity": ["case", ["any", ["boolean", ["feature-state", "hl"], false], ["boolean", ["feature-state", "sel"], false]], 1, 0] } });
      map.addLayer({ id: "countries-hl", type: "line", source: "countries",
        layout: { visibility: "none" },
        paint: { "line-color": "#0b0b0b", "line-width": ["case", ["boolean", ["feature-state", "sel"], false], 2.2, 1.4],
          "line-opacity": ["case", ["any", ["boolean", ["feature-state", "hl"], false], ["boolean", ["feature-state", "sel"], false]], 1, 0] } });
      map.addLayer({ id: "pop-circles", type: "circle", source: "pts",
        layout: { visibility: "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"],
            0, ["max", 1.2, ["*", 0.0006, ["sqrt", ["get", "pop"]]]],
            2, ["max", 1.5, ["*", 0.0012, ["sqrt", ["get", "pop"]]]],
            5, ["max", 2, ["*", 0.0042, ["sqrt", ["get", "pop"]]]]],
          "circle-color": "rgba(255,255,255,0.18)",
          "circle-stroke-color": "#2c2b28", "circle-stroke-width": 1, "circle-stroke-opacity": 0.75,
          "circle-pitch-alignment": "map"
        } });
      map.addLayer({ id: "small-dots", type: "circle", source: "pts",
        filter: ["<", ["get", "area"], 30000],
        layout: { visibility: "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 2.5, 3, 4, 6, 6],
          "circle-color": ["coalesce", ["feature-state", "c"], NODATA],
          "circle-stroke-color": ["case", ["boolean", ["feature-state", "hl"], false], "#0b0b0b", "#ffffff"],
          "circle-stroke-width": ["case", ["boolean", ["feature-state", "hl"], false], 1.8, 1]
        } });

      bindMapEvents();
      $("#loading").hidden = true;
      render();
    });
    map.on("zoomend", () => { if (state.ch === 3) updateCircleLegend(); });
  }

  function bindMapEvents() {
    const tip = $("#tooltip");
    const layers = () => state.ch === 3 ? ["small-dots", "countries-fill"] : ["regions-fill"];
    map.on("mousemove", e => {
      const f = map.queryRenderedFeatures(e.point, { layers: layers() })[0];
      if (!f) { clearHover(); tip.hidden = true; map.getCanvas().style.cursor = ""; return; }
      const key = f.properties.k;
      const src = f.layer.id === "regions-fill" ? "regions" : "countries";
      if (key !== hoverKey || src !== hoverSrc) {
        clearHover();
        hoverKey = key; hoverSrc = src;
        map.setFeatureState({ source: src, id: key }, { hl: true });
        if (state.ch === 3) map.setFeatureState({ source: "pts", id: key }, { hl: true });
      }
      const html = src === "regions" ? regionTip(key) : countryTip(key);
      if (!html) { tip.hidden = true; return; }
      tip.innerHTML = html; tip.hidden = false;
      const r = $("#map-wrap").getBoundingClientRect();
      let x = e.point.x + 14, y = e.point.y + 14;
      if (x + 270 > r.width) x = e.point.x - 270;
      if (y + 110 > r.height) y = e.point.y - 110;
      tip.style.left = x + "px"; tip.style.top = y + "px";
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseout", () => { clearHover(); tip.hidden = true; });
    map.on("click", e => {
      const f = map.queryRenderedFeatures(e.point, { layers: layers() })[0];
      if (!f) { closeCard(); return; }
      select(f.layer.id === "regions-fill" ? "regions" : "countries", f.properties.k, false);
    });
  }
  function clearHover() {
    if (hoverKey == null) return;
    map.setFeatureState({ source: hoverSrc, id: hoverKey }, { hl: false });
    if (hoverSrc === "countries") map.setFeatureState({ source: "pts", id: hoverKey }, { hl: false });
    hoverKey = null; hoverSrc = null;
  }

  function select(src, key, fly) {
    if (selKey != null) map.setFeatureState({ source: selSrc, id: selKey }, { sel: false });
    selSrc = src; selKey = key; state.sel = key;
    map.setFeatureState({ source: src, id: key }, { sel: true });
    showCard();
    if (fly) {
      const b = (src === "regions" ? bboxR : bboxC)[key];
      if (b) {
        const pad = window.innerWidth < 860 ? 30 : { top: 90, bottom: 50, left: 400, right: 70 };
        map.fitBounds(b, { padding: pad, maxZoom: src === "regions" ? 5.5 : 4.5, duration: 1400 });
      }
    }
  }
  const HOME = { 1: [12, 28], 2: [30, 24], 3: [-35, 18] };
  function flyHome() {
    if (!map) return;
    map.flyTo({ center: HOME[state.ch], zoom: window.innerWidth < 860 ? 0.8 : 2.05, duration: 1400 });
  }
  function closeCard() {
    $("#card").hidden = true;
    if (selKey != null) map.setFeatureState({ source: selSrc, id: selKey }, { sel: false });
    selKey = null; selSrc = null; state.sel = null;
  }

  // ---------------------------------------------------------------- tooltips
  function regionTip(key) {
    const i = idx[key]; if (i == null) return null;
    let v;
    if (state.ch === 1) {
      v = `<b>${fmt0(C.base[state.profile][i])}</b> comfortable ${PROFILE[state.profile].short} days a year`;
    } else if (state.ind2 === "delta") {
      const f = C.fut[futKey()];
      v = `${PROFILE[state.profile].label}: <b>${fmt0(C.base[state.profile][i])} → ${fmt0(f[state.profile][i])}</b> days (${signed(f[state.profile][i] - C.base[state.profile][i])})`;
    } else {
      const f = C.fut[futKey()];
      v = `Heat-stress days: <b>${fmt0(C.base.hot[i])} → ${fmt0(f.hot[i])}</b> a year`;
    }
    return `<b>${esc(regionLabel(i))}</b><div class="tt-sub">${esc(regionCountry(i))}</div><div class="tt-v">${v}</div>`;
  }
  function countryTip(iso) {
    const e = ECO[iso]; if (!e) return null;
    let v = "";
    if (state.view3 === "dep") {
      v = e.rx_gdp != null || e.rx_exp != null
        ? `Tourism receipts: <b>${fmt1(state.meas3 === "gdp" ? e.rx_gdp : e.rx_exp)} %</b> of ${state.meas3 === "gdp" ? "GDP" : "exports"} (${e.rx_year})`
        : "No tourism receipts data";
    } else {
      const c = climDelta(e);
      v = `Tourism: <b>${fmt1(e.rx_gdp)} %</b> of GDP<br>Comfortable days: <b>${signed(c)}</b> a year (${SCEN[state.scen].short}, ${PER[state.per]})`;
    }
    if (e.pop) v += `<br>Population: ${fmtPop(e.pop)}`;
    return `<b>${esc(e.name)}</b><div class="tt-v">${v}</div>`;
  }

  // ---------------------------------------------------------------- detail card
  function showCard() {
    const card = $("#card");
    card.innerHTML = selSrc === "regions" ? regionCard(selKey) : countryCard(selKey);
    card.hidden = false;
    $(".card-close", card).onclick = closeCard;
  }
  function regionCard(key) {
    const i = idx[key]; const b = C.base;
    let h = `<button class="card-close" aria-label="Close">×</button><h3>${esc(regionLabel(i))}</h3><div class="card-sub">${esc(regionCountry(i))}</div>`;
    if (state.ch === 1) {
      h += `<dl class="kv">
        <dt>Comfortable days · sightseeing &amp; city</dt><dd>${fmt0(b.sight[i])}</dd>
        <dt>Comfortable days · beach &amp; sun</dt><dd>${fmt0(b.beach[i])}</dd>
        <dt>Heat-stress days</dt><dd>${fmt0(b.hot[i])}</dd>
        <dt>Mean temperature</dt><dd>${fmt1(b.T[i])} °C</dd></dl>`;
      const best = bestMonths(b[state.profile + "_m"][i]);
      h += `<div class="chart-h">Comfortable ${PROFILE[state.profile].short} days by month${best ? " · best: " + best : ""}</div>`;
      h += monthChart([{ v: b[state.profile + "_m"][i], c: "#2a78d6" }], 31, { rows: [["°C", b.Tm[i].map(x => Math.round(x))], ["mm", b.Pm[i]]] });
      h += `<div class="foot">Average of 2020–2025. Rows below the bars: mean temperature and total precipitation per month.</div>`;
    } else {
      const f = C.fut[futKey()], p = state.profile;
      h += `<dl class="kv">
        <dt>Extra warming vs today (${SCEN[state.scen].short}, ${PER[state.per]})</dt><dd>+${fmt1(f.dT[i])} °C</dd>
        <dt>${PROFILE[p].label} days</dt><dd>${fmt0(b[p][i])} → ${fmt0(f[p][i])}</dd>
        <dt>Range across ${f.n} models</dt><dd>${fmt0(f[p + "_lo"][i])}–${fmt0(f[p + "_hi"][i])}</dd>
        <dt>Heat-stress days</dt><dd>${fmt0(b.hot[i])} → ${fmt0(f.hot[i])}</dd></dl>`;
      if (state.ind2 === "delta") {
        h += `<div class="chart-h">${PROFILE[p].label}: comfortable days by month</div>`;
        h += `<div class="chart-legend"><span><i style="background:#b4b2aa"></i>Today</span><span><i style="background:#2a78d6"></i>${PER[state.per]}</span></div>`;
        h += monthChart([{ v: b[p + "_m"][i], c: "#b4b2aa" }, { v: f[p + "_m"][i], c: "#2a78d6" }], 31);
      } else {
        h += `<div class="chart-h">Heat-stress days by month</div>`;
        h += `<div class="chart-legend"><span><i style="background:#b4b2aa"></i>Today</span><span><i style="background:#d6534a"></i>${PER[state.per]}</span></div>`;
        h += monthChart([{ v: b.hot_m[i], c: "#b4b2aa" }, { v: f.hot_m[i], c: "#d6534a" }], 31);
      }
      h += `<div class="foot">Median of CMIP6 models (WorldClim 2.1) applied to 2020–2025 daily weather. Humidity and rain kept at today's values.</div>`;
    }
    return h;
  }
  function countryCard(iso) {
    const e = ECO[iso];
    let h = `<button class="card-close" aria-label="Close">×</button><h3>${esc(e.name)}</h3><div class="card-sub">${esc(e.cont && !/Seven seas/.test(e.cont) ? e.cont : "Island state")}</div>`;
    h += `<dl class="kv">
      <dt>Tourism receipts, % of GDP</dt><dd>${e.rx_gdp != null ? fmt1(e.rx_gdp) + " %" : "–"}</dd>
      <dt>Tourism receipts, % of exports</dt><dd>${e.rx_exp != null ? fmt1(e.rx_exp) + " %" : "–"}</dd>
      <dt>Receipts reference year</dt><dd>${e.rx_year || "–"}</dd>
      <dt>Population (${e.pop_year || "–"})</dt><dd>${e.pop ? fmtPop(e.pop) : "–"}</dd>
      <dt>GDP (${e.gdp_year || "–"})</dt><dd>${e.gdp ? fmtUsd(e.gdp) : "–"}</dd>
      <dt>GDP per person</dt><dd>${e.gdppc ? "$" + fmt0(e.gdppc) : "–"}</dd></dl>`;
    if (e.any0 != null) {
      h += `<div class="chart-h">Climate comfort, population-weighted (${SCEN[state.scen].short})</div>`;
      const rows = [["Today", e.any0, e.hot0]];
      for (const p of Object.keys(PER)) rows.push([PER[p], e["any_" + state.scen + "_" + p], e["hot_" + state.scen + "_" + p]]);
      h += pairBars(rows);
      h += `<div class="foot">Comfortable days: either tourism profile. Tourism receipts are earnings from foreign visitors (World Bank WDI); domestic tourism is not included.</div>`;
    }
    return h;
  }
  function bestMonths(m) {
    const mx = Math.max(...m); if (mx < 3) return "";
    if (m.every(v => v >= mx * 0.8)) return "all year";
    return m.map((v, k) => v >= mx * 0.8 ? MONTHS_LONG[k] : null).filter(Boolean).join(", ");
  }
  function monthChart(series, ymax, opt = {}) {
    const W = 328, H = 96, L = 22, B = 14, cw = (W - L) / 12;
    const n = series.length, gap = 2, bw = Math.min(10, (cw - 6 - gap * (n - 1)) / n);
    const extraRows = (opt.rows || []).length;
    let s = `<svg viewBox="0 0 ${W} ${H + extraRows * 14 + 2}" role="img" aria-label="Monthly chart">`;
    [0, 15, 30].forEach(t => {
      const y = H - B - (t / ymax) * (H - B - 6);
      s += `<line x1="${L}" x2="${W}" y1="${y}" y2="${y}" stroke="${t ? "#e1e0d9" : "#c3c2b7"}" stroke-width="1"/>`;
      s += `<text x="${L - 4}" y="${y + 3.5}" font-size="9.5" fill="#898781" text-anchor="end">${t}</text>`;
    });
    for (let m = 0; m < 12; m++) {
      const x0 = L + m * cw + (cw - (n * bw + (n - 1) * gap)) / 2;
      series.forEach((sr, k) => {
        const v = Math.max(0, sr.v[m]), hgt = (v / ymax) * (H - B - 6);
        const x = x0 + k * (bw + gap), y = H - B - hgt;
        if (hgt > 0.5) s += `<path d="${roundTop(x, y, bw, hgt)}" fill="${sr.c}"><title>${MONTHS_LONG[m]}: ${v} days</title></path>`;
      });
      s += `<text x="${L + m * cw + cw / 2}" y="${H - 2}" font-size="9.5" fill="#898781" text-anchor="middle">${MONTHS[m]}</text>`;
      (opt.rows || []).forEach((r, k) => {
        s += `<text x="${L + m * cw + cw / 2}" y="${H + 12 + k * 14}" font-size="9.5" fill="#52514e" text-anchor="middle">${r[1][m]}</text>`;
      });
    }
    (opt.rows || []).forEach((r, k) => { s += `<text x="0" y="${H + 12 + k * 14}" font-size="9.5" fill="#898781">${r[0]}</text>`; });
    return s + "</svg>";
  }
  function roundTop(x, y, w, h) {
    const r = Math.min(3, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  function pairBars(rows) {
    const W = 328, rowH = 34, L = 84, H = rows.length * rowH + 22;
    let s = `<div class="chart-legend"><span><i style="background:#2a78d6"></i>Comfortable days</span><span><i style="background:#d6534a"></i>Heat-stress days</span></div>`;
    s += `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Comfortable and heat-stress days">`;
    const sx = v => L + (v / 365) * (W - L - 34);
    [0, 90, 180, 270, 365].forEach(t => {
      s += `<line x1="${sx(t)}" x2="${sx(t)}" y1="0" y2="${H - 16}" stroke="#e1e0d9"/>`;
      s += `<text x="${sx(t)}" y="${H - 4}" font-size="9.5" fill="#898781" text-anchor="middle">${t}</text>`;
    });
    rows.forEach((r, k) => {
      const y = k * rowH + 4;
      s += `<text x="0" y="${y + 14}" font-size="11" fill="#52514e">${r[0]}</text>`;
      [[r[1], "#2a78d6", 0], [r[2], "#d6534a", 13]].forEach(([v, c, dy]) => {
        const w = Math.max(0, sx(v || 0) - L);
        if (w > 0.5) s += `<rect x="${L}" y="${y + dy}" width="${w}" height="10" rx="2" fill="${c}"/>`;
        s += `<text x="${L + w + 4}" y="${y + dy + 8.5}" font-size="9.5" fill="#52514e">${fmt0(v)}</text>`;
      });
    });
    return s + "</svg>";
  }

  // ---------------------------------------------------------------- painting
  function paint() {
    if (!map || !map.getSource("regions")) return;
    const regionMode = state.ch !== 3;
    const vis = (id, on) => map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    vis("regions-fill", regionMode); vis("regions-line", regionMode); vis("regions-hl", regionMode);
    vis("countries-fill", !regionMode); vis("countries-hl", !regionMode);
    vis("small-dots", !regionMode); vis("pop-circles", !regionMode && state.showPop);
    map.setPaintProperty("countries-line", "line-color", regionMode ? "#5f5e59" : "#ffffff");
    map.setPaintProperty("countries-line", "line-opacity", regionMode ? 0.45 : 0.9);
    if (regionMode) {
      for (let i = 0; i < C.ids.length; i++) map.setFeatureState({ source: "regions", id: C.ids[i] }, { c: regionColor(i) });
    } else {
      for (const f of countriesFC.features) map.setFeatureState({ source: "countries", id: f.id }, { c: countryColor(f.id) });
      for (const f of ptsFC.features) map.setFeatureState({ source: "pts", id: f.properties.k }, { c: countryColor(f.properties.k) });
    }
    // map title
    let t = "", s = "";
    if (state.ch === 1) { t = `Comfortable ${PROFILE[state.profile].short} days per year`; s = `Today (2020–2025) · ${PROFILE[state.profile].band}, dry, no heat stress`; }
    else if (state.ch === 2) {
      t = state.ind2 === "delta" ? `Change in comfortable ${PROFILE[state.profile].short} days per year` : "Heat-stress days per year";
      s = `${SCEN[state.scen].long} · ${PER[state.per]} vs today`;
    } else {
      t = state.view3 === "dep" ? `International tourism receipts, % of ${state.meas3 === "gdp" ? "GDP" : "exports"}` : "Tourism dependence × change in comfortable days";
      s = state.view3 === "dep" ? "Latest pre-pandemic year (2015–2019) · circles: population" : `${SCEN[state.scen].long} · ${PER[state.per]} · circles: population`;
    }
    $("#map-title").innerHTML = `<b>${t}</b><span>${s}</span>`;
    if (selKey != null && !$("#card").hidden) showCard();
  }

  // ---------------------------------------------------------------- side panel
  function seg(name, options, current) {
    return `<div class="seg" data-ctl="${name}">` + options.map(([v, l]) =>
      `<button type="button" data-v="${v}" aria-pressed="${String(v) === String(current)}">${l}</button>`).join("") + `</div>`;
  }
  function control(label, html) { return `<div class="control"><div class="control-label">${label}</div>${html}</div>`; }
  function legendBar(colors, ticks, ends) {
    let h = `<div class="legend-bar">${colors.map(c => `<span style="background:${c}"></span>`).join("")}</div>`;
    if (ticks) h += `<div class="legend-ticks" style="margin-left:-${50 / colors.length}%;margin-right:-${50 / colors.length}%">${ticks.map(t => `<span>${t}</span>`).join("")}</div>`;
    if (ends) h += `<div class="legend-ends"><span>${ends[0]}</span><span>${ends[1]}</span></div>`;
    return h;
  }
  const noData = `<div class="legend-nodata"><span class="swatch" style="background:${NODATA}"></span>No data</div>`;
  function rankList(items) {
    return `<ol class="rank">${items.map(it => `<li data-src="${it.src}" data-k="${esc(it.k)}"><span class="nm">${esc(it.name)}${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</span><span class="val">${it.val}</span></li>`).join("")}</ol>`;
  }
  // ranked regions: skip very small units (< 1,000 km²) and show at most two regions per country
  function topRegions(valueFn, n, desc = true) {
    const arr = [];
    for (let i = 0; i < C.ids.length; i++) {
      const v = valueFn(i);
      if (v != null && !isNaN(v) && C.area[i] >= 1000) arr.push([i, v]);
    }
    arr.sort((a, b) => desc ? b[1] - a[1] : a[1] - b[1]);
    const out = [], per = {};
    for (const it of arr) {
      const c = C.iso[it[0]]; per[c] = (per[c] || 0) + 1;
      if (per[c] <= 2) out.push(it);
      if (out.length === n) break;
    }
    return out;
  }

  function chapter1() {
    const p = state.profile, b = C.base;
    const half = b[p].filter(v => v >= 182).length, few = b[p].filter(v => v < 30).length;
    const top = topRegions(i => b[p][i], 8).map(([i, v]) => ({ src: "regions", k: C.ids[i], name: regionLabel(i), sub: regionCountry(i), val: fmt0(v) + " d" }));
    return `
      <div class="ch-eyebrow">Map 01 · Today</div>
      <h2 class="ch-title">Where Does Climate Attract Tourists Today?</h2>
      <p class="ch-sub">The geography of climate comfort across tourist destinations</p>
      <p class="lead">Climate is one resource a destination cannot build. This map counts, for every first-level region of the world, the days of a typical recent year that are <b>comfortable for outdoor leisure</b>: warm enough, not dangerously hot and humid, and dry. It is based on daily weather for 2020–2025.</p>
      <div class="section">
        <div class="section-h">Tourism profile</div>
        ${control("Different trips need different weather", seg("profile", [["sight", "Sightseeing &amp; city"], ["beach", "Beach &amp; sun"]], p))}
        <p class="note">${p === "sight" ? "Sightseeing &amp; city: daily mean 15–24 °C — pleasant for walking, museums, hiking." : "Beach &amp; sun: daily mean 23–30 °C — swimming and sunbathing weather."} Both profiles: precipitation ≤ 5 mm and no heat stress.</p>
      </div>
      <div class="section">
        <div class="legend-title">Comfortable days per year</div>
        ${legendBar(SEQ_DAYS.colors, SEQ_DAYS.ticks)}
        ${noData}
      </div>
      <div class="section">
        <div class="stats">
          <div class="stat"><div class="stat-v">${fmt0(half)}</div><div class="stat-l">regions are comfortable for ${PROFILE[p].short} at least half the year</div></div>
          <div class="stat"><div class="stat-v">${fmt0(few)}</div><div class="stat-l">regions have fewer than 30 comfortable days</div></div>
        </div>
      </div>
      <div class="section">
        <div class="section-h">Most comfortable regions · ${PROFILE[p].label.toLowerCase()}</div>
        ${rankList(top)}
        <p class="note">Click a region on the map to see its climate calendar: comfortable days, temperature and rain by month.</p>
      </div>
      ${methodBlock()}`;
  }

  function chapter2() {
    const p = state.profile, f = C.fut[futKey()], b = C.base;
    let listsHtml, statsHtml, legendHtml;
    if (state.ind2 === "delta") {
      const d = i => f[p][i] - b[p][i];
      let lose = 0, gain = 0;
      for (let i = 0; i < C.ids.length; i++) { const v = d(i); if (v <= -10) lose++; else if (v >= 10) gain++; }
      const losers = topRegions(d, 7, false).map(([i, v]) => ({ src: "regions", k: C.ids[i], name: regionLabel(i), sub: regionCountry(i), val: signed(v) }));
      const gainers = topRegions(d, 7, true).map(([i, v]) => ({ src: "regions", k: C.ids[i], name: regionLabel(i), sub: regionCountry(i), val: signed(v) }));
      statsHtml = `<div class="stat"><div class="stat-v">${fmt0(lose)}</div><div class="stat-l">regions lose 10+ comfortable ${PROFILE[p].short} days a year</div></div>
                   <div class="stat"><div class="stat-v">${fmt0(gain)}</div><div class="stat-l">regions gain 10+ days — mostly cooler, higher-latitude places</div></div>`;
      listsHtml = `<div class="two-col"><div><div class="section-h">Biggest losses</div>${rankList(losers)}</div><div><div class="section-h">Biggest gains</div>${rankList(gainers)}</div></div>`;
      legendHtml = `<div class="legend-title">Change in comfortable days per year</div>${legendBar(DIV_DELTA.colors, DIV_DELTA.ticks, ["Fewer days", "More days"])}`;
    } else {
      let now = 0, fut = 0;
      for (let i = 0; i < C.ids.length; i++) { if (b.hot[i] >= 30) now++; if (f.hot[i] >= 30) fut++; }
      const top = topRegions(i => f.hot[i] - b.hot[i], 8).map(([i, v]) => ({ src: "regions", k: C.ids[i], name: regionLabel(i), sub: regionCountry(i), val: `${fmt0(b.hot[i])} → ${fmt0(f.hot[i])}` }));
      statsHtml = `<div class="stat"><div class="stat-v">${fmt0(now)}</div><div class="stat-l">regions have 30+ heat-stress days a year today</div></div>
                   <div class="stat"><div class="stat-v">${fmt0(fut)}</div><div class="stat-l">regions in ${PER[state.per]} under ${SCEN[state.scen].short}</div></div>`;
      listsHtml = `<div class="section-h">Largest increase in heat-stress days</div>${rankList(top)}`;
      legendHtml = `<div class="legend-title">Heat-stress days per year, ${PER[state.per]}</div>${legendBar(SEQ_HOT.colors, SEQ_HOT.ticks)}<p class="note">Heat-stress day: daily mean humidex ≥ 42, i.e. afternoon heat and humidity in the “dangerous” range.</p>`;
    }
    return `
      <div class="ch-eyebrow">Map 02 · Future</div>
      <h2 class="ch-title">Will Our Favourite Destinations Become Too Hot?</h2>
      <p class="ch-sub">How climate suitability of tourist regions changes</p>
      <p class="lead">Warming moves the tourism calendar. Places that are already hot <b>lose comfortable days and gain dangerous heat</b>, often in their peak summer season, while cooler regions gain pleasant shoulder-season days. Projections add the warming expected by CMIP6 climate models to today's daily weather.</p>
      <div class="section">
        ${control("Indicator", seg("ind2", [["delta", "Change in comfortable days"], ["hot", "Heat-stress days"]], state.ind2))}
        ${state.ind2 === "delta" ? control("Tourism profile", seg("profile", [["sight", "Sightseeing &amp; city"], ["beach", "Beach &amp; sun"]], p)) : ""}
        ${control("Emissions scenario", seg("scen", [["ssp126", "SSP1-2.6"], ["ssp245", "SSP2-4.5"], ["ssp585", "SSP5-8.5"]], state.scen))}
        ${control("Period", seg("per", [["2041-2060", "2041–2060"], ["2081-2100", "2081–2100"]], state.per))}
        <p class="note">${SCEN[state.scen].long}. Median of ${f.n} CMIP6 models; typical global land warming relative to 2021–2040 is about +${fmt1(median(f.dT))} °C.</p>
      </div>
      <div class="section">${legendHtml}${noData}</div>
      <div class="section"><div class="stats">${statsHtml}</div></div>
      <div class="section">${listsHtml}
        <p class="note">Click a region to compare its month-by-month calendar today and in the future.</p></div>
      ${methodBlock()}`;
  }

  function chapter3() {
    const fk = futKey();
    const all = Object.entries(ECO);
    const high = all.filter(([, e]) => e.rx_gdp != null && e.rx_gdp >= DEP_CUTS[1]);
    const highPop = high.reduce((s, [, e]) => s + (e.pop || 0), 0);
    const exposed = high.filter(([, e]) => { const c = climDelta(e); return c != null && c < -CLIM_CUT; });
    const exposedPop = exposed.reduce((s, [, e]) => s + (e.pop || 0), 0);
    const meas = state.meas3;
    const top = all.filter(([, e]) => depValue(e) != null).sort((a, b) => depValue(b[1]) - depValue(a[1])).slice(0, 10)
      .map(([k, e]) => ({ src: "countries", k, name: e.name, sub: e.pop ? fmtPop(e.pop) : "", val: fmt1(depValue(e)) + " %" }));
    const expList = exposed.sort((a, b) => climDelta(a[1]) - climDelta(b[1])).slice(0, 10)
      .map(([k, e]) => ({ src: "countries", k, name: e.name, sub: fmt1(e.rx_gdp) + " % of GDP", val: signed(climDelta(e)) + " d" }));

    let legend;
    if (state.view3 === "dep") {
      legend = `<div class="legend-title">Tourism receipts, % of ${meas === "gdp" ? "GDP" : "exports"}</div>${legendBar(SEQ_DEP.colors, SEQ_DEP[meas].ticks)}`;
    } else {
      const cells = [];
      for (let r = 2; r >= 0; r--) for (let c = 0; c < 3; c++) cells.push(`<span style="background:${BIVAR[r][c]}"></span>`);
      legend = `<div class="legend-title">Dependence × climate change</div>
        <div class="bivar">
          <div class="bivar-y">Tourism, % of GDP →</div>
          <div style="display:flex;gap:12px;align-items:flex-start">
            <div><div class="bivar-grid">${cells.join("")}</div></div>
            <div class="bivar-key">Rows: tourism receipts<br>&lt; 3 % · 3–10 % · ≥ 10 % of GDP<br><br>Columns: comfortable days<br>gain &gt; ${CLIM_CUT} · little change · loss &gt; ${CLIM_CUT}</div>
          </div>
          <div></div><div class="bivar-x"><span>gain</span><span>loss →</span></div>
        </div>`;
    }
    return `
      <div class="ch-eyebrow">Map 03 · Exposure</div>
      <h2 class="ch-title">Which Economies Depend on Climate-Sensitive Tourism?</h2>
      <p class="ch-sub">Population and economy of countries that depend on tourism</p>
      <p class="lead">Where tourism carries the economy, a changing climate becomes an economic risk. The map shows how much <b>international tourism earns</b> for each country, how many people live there, and — in the second view — whether its climate comfort is projected to improve or decline.</p>
      <div class="section">
        ${control("View", seg("view3", [["dep", "Tourism dependence"], ["bi", "Dependence × climate"]], state.view3))}
        ${state.view3 === "dep"
          ? control("Measure", seg("meas3", [["gdp", "% of GDP"], ["exp", "% of exports"]], meas))
          : control("Emissions scenario", seg("scen", [["ssp126", "SSP1-2.6"], ["ssp245", "SSP2-4.5"], ["ssp585", "SSP5-8.5"]], state.scen)) +
            control("Period", seg("per", [["2041-2060", "2041–2060"], ["2081-2100", "2081–2100"]], state.per))}
        <label class="check"><input type="checkbox" data-ctl="showPop" ${state.showPop ? "checked" : ""}> Show population circles</label>
      </div>
      <div class="section">${legend}${noData}
        <div class="circles-legend" id="circles-legend"></div>
        <p class="note">Small states (under 30,000 km²) are drawn as coloured dots so they stay visible at world scale.</p>
      </div>
      <div class="section"><div class="stats">
        <div class="stat"><div class="stat-v">${high.length}</div><div class="stat-l">economies earn ≥ 10 % of GDP from foreign visitors · ${fmtPop(highPop)} people</div></div>
        <div class="stat"><div class="stat-v">${exposed.length}</div><div class="stat-l">of them lose comfortable days (${SCEN[state.scen].short}, ${PER[state.per]}) · ${fmtPop(exposedPop)} people</div></div>
      </div></div>
      <div class="section">
        ${state.view3 === "dep"
          ? `<div class="section-h">Most tourism-dependent economies</div>${rankList(top)}`
          : `<div class="section-h">High dependence, shrinking comfort</div>${expList.length ? rankList(expList) : `<p class="note">No high-dependence economy loses more than ${CLIM_CUT} days in this scenario.</p>`}`}
        <p class="note">Click a country for its economic profile and climate outlook.</p>
      </div>
      ${methodBlock()}`;
  }

  function methodBlock() {
    const t = {
      1: `<ul><li>Daily ERA5 temperature, humidity and precipitation (2020–2025), averaged by region (AREAdata, GADM 3.6 level 1).</li>
          <li>Temperature adjusted to WorldClim 2.1 near-surface climate (removes the warm bias of the 1000 hPa level over high ground).</li>
          <li>A day counts as comfortable when the daily mean temperature is in the profile's band, precipitation ≤ 5 mm and humidex &lt; 42. Bands follow the Holiday Climate Index (Scott et al. 2016).</li>
          <li>Sunshine, wind and sea temperature are not included; values are regional averages.</li></ul>`,
      2: `<ul><li>Warming of each region from WorldClim 2.1 downscaled CMIP6 (up to 9 models), 2021–2040 → future period, added to every day of 2020–2025 (delta method).</li>
          <li>Map shows the median across models; the region card gives the model range.</li>
          <li>Humidity (relative) and precipitation are kept as today; heat stress = daily mean humidex ≥ 42.</li>
          <li>Days near a threshold can flip with small warming, so humid tropical regions react strongly.</li></ul>`,
      3: `<ul><li>Tourism receipts, % of exports: World Bank WDI ST.INT.RCPT.XP.ZS, latest value 2015–2019 (before the pandemic).</li>
          <li>% of GDP = % of exports × exports of goods and services as % of GDP (NE.EXP.GNFS.ZS), same year.</li>
          <li>Population: SP.POP.TOTL, latest year. Climate change: comfortable days (either profile), population-weighted average over each country's regions.</li>
          <li>Foreign-visitor earnings only; domestic tourism and indirect effects are not included.</li></ul>`
    };
    return `<details class="method"><summary>Method &amp; data</summary>${t[state.ch]}<p><a href="#about" data-about>Full methodology</a></p></details>`;
  }

  function median(a) { const s = a.filter(v => v != null).slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

  function updateCircleLegend() {
    const el = $("#circles-legend"); if (!el || !map) return;
    if (!state.showPop) { el.innerHTML = ""; return; }
    const z = map.getZoom();
    const k = z <= 0 ? 0.0006 : z <= 2 ? 0.0006 + (0.0012 - 0.0006) * (z / 2) : z <= 5 ? 0.0012 + (0.0042 - 0.0012) * ((z - 2) / 3) : 0.0042;
    const cand = [[1e6, "1 m"], [1e7, "10 m"], [1e8, "100 m"], [1e9, "1 bn"]].filter(([v]) => k * Math.sqrt(v) <= 42).slice(-3);
    el.innerHTML = cand.map(([v, l]) => {
      const r = Math.max(1.5, k * Math.sqrt(v));
      return `<div><i style="width:${2 * r}px;height:${2 * r}px"></i>${l}</div>`;
    }).join("") + `<div style="align-self:center;margin-left:-4px">people</div>`;
  }

  function render() {
    document.querySelectorAll(".chapter").forEach(b => b.setAttribute("aria-selected", String(+b.dataset.ch === state.ch)));
    const body = $("#chapter-body");
    body.innerHTML = state.ch === 1 ? chapter1() : state.ch === 2 ? chapter2() : chapter3();
    body.querySelectorAll(".seg").forEach(segEl => {
      segEl.addEventListener("click", ev => {
        const btn = ev.target.closest("button"); if (!btn) return;
        state[segEl.dataset.ctl] = btn.dataset.v;
        const st = body.scrollTop; render(); body.scrollTop = st;
      });
    });
    const cb = body.querySelector('[data-ctl="showPop"]');
    if (cb) cb.addEventListener("change", () => { state.showPop = cb.checked; paint(); updateCircleLegend(); });
    body.querySelectorAll(".rank li").forEach(li => li.addEventListener("click", () => select(li.dataset.src, li.dataset.k, true)));
    body.querySelectorAll("[data-about]").forEach(a => a.addEventListener("click", ev => { ev.preventDefault(); $("#about").showModal(); }));
    paint();
    if (state.ch === 3) updateCircleLegend();
  }

  function setChapter(ch) {
    if (ch === state.ch) return;
    // a selection belongs to one geography (regions vs countries)
    const wasRegion = state.ch !== 3, isRegion = ch !== 3;
    if (wasRegion !== isRegion) closeCard();
    state.ch = ch;
    flyHome();
    history.replaceState(null, "", "#map-" + ch);
    $("#chapter-body").scrollTop = 0;
    render();
  }

  // ---------------------------------------------------------------- boot
  document.querySelectorAll(".chapter").forEach(b => b.addEventListener("click", () => setChapter(+b.dataset.ch)));
  $("#about-link").addEventListener("click", ev => { ev.preventDefault(); $("#about").showModal(); });
  $(".about-close").addEventListener("click", () => $("#about").close());
  $("#about").addEventListener("click", ev => { if (ev.target.id === "about") $("#about").close(); });
  $("#btn-globe").addEventListener("click", () => {
    state.globe = !state.globe;
    map.setProjection({ type: state.globe ? "globe" : "mercator" });
    $("#btn-globe").textContent = state.globe ? "Globe" : "Flat";
    $("#btn-globe").setAttribute("aria-pressed", String(state.globe));
  });
  $("#btn-reset").addEventListener("click", flyHome);
  window.addEventListener("keydown", ev => { if (ev.key === "Escape") closeCard(); });

  const m = /#map-([123])/.exec(location.hash);
  if (m) state.ch = +m[1];
  document.querySelectorAll(".chapter").forEach(b => b.setAttribute("aria-selected", String(+b.dataset.ch === state.ch)));

  loadData().then(initMap).catch(err => {
    $("#loading").textContent = "Could not load data: " + err.message + ". If you opened the file directly, serve the folder over HTTP (see README).";
    console.error(err);
  });
})();
