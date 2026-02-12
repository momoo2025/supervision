const equipments = window.SUPERVISION_DATA?.equipments || [];
const LAST_EQUIPMENT_KEY = "lastEquipmentId";

const titleEl = document.getElementById("equipmentTitle");
const statusEl = document.getElementById("equipmentStatus");
const mainInfoEl = document.getElementById("mainInfo");
const maintenanceInfoEl = document.getElementById("maintenanceInfo");
const alertsEl = document.getElementById("maintenanceAlerts");
const documentsEl = document.getElementById("documentsList");
const exitButton = document.getElementById("exitButton");
const stepButtons = Array.from(document.querySelectorAll(".step-btn"));
const periodFilter = document.getElementById("periodFilter");

const RANGE_OPTIONS = {
  minute: [30, 60, 180, 360],
  hour: [8, 12, 24, 72],
  day: [1, 3, 7, 14],
  week: [1, 2, 4, 8]
};

const RANGE_SUFFIX = {
  minute: "m",
  hour: "h",
  day: "j",
  week: "sem"
};

let currentEquipment = null;
let selectedStep = "minute";
let selectedRange = RANGE_OPTIONS.minute[1];

function getEquipmentFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  return equipments.find((item) => item.id === id) || equipments[0];
}

function makeKv(label, value) {
  const box = document.createElement("div");
  box.className = "kv";

  const labelEl = document.createElement("span");
  labelEl.textContent = label;

  const valueEl = document.createElement("strong");
  valueEl.textContent = value || "-";

  box.appendChild(labelEl);
  box.appendChild(valueEl);
  return box;
}

function renderMainInfo(eq) {
  mainInfoEl.innerHTML = "";
  [
    ["Type", eq.type],
    ["Zone", eq.zone],
    ["Service", eq.service],
    ["Fabricant", eq.fabricant],
    ["Modele", eq.modele],
    ["N de serie", eq.serial],
    ["Pression", eq.metrics?.pression],
    ["Temperature", eq.metrics?.temperature],
    ["Charge", eq.metrics?.charge],
    ["Puissance", eq.metrics?.kw]
  ].forEach(([label, value]) => mainInfoEl.appendChild(makeKv(label, value)));
}

function renderMaintenance(eq) {
  maintenanceInfoEl.innerHTML = "";
  [
    ["Derniere maintenance", eq.maintenance?.derniere],
    ["Prochaine maintenance", eq.maintenance?.prochaine],
    ["Statut", eq.maintenance?.statut],
    ["Technicien", eq.maintenance?.technicien]
  ].forEach(([label, value]) => maintenanceInfoEl.appendChild(makeKv(label, value)));

  alertsEl.innerHTML = "";
  (eq.maintenance?.alertes || ["Aucune alerte"]).forEach((alert) => {
    const li = document.createElement("li");
    li.textContent = alert;
    alertsEl.appendChild(li);
  });
}

function renderDocuments(eq) {
  documentsEl.innerHTML = "";

  (eq.documents || []).forEach((doc) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${doc.nom}</strong><div class="doc-meta">${doc.type} - ${doc.date}</div>`;
    documentsEl.appendChild(li);
  });
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function interpolateMinutes(values, minuteRange) {
  const neededHours = Math.max(2, Math.ceil(minuteRange / 60) + 1);
  const base = values.slice(-neededHours);
  const expanded = [];

  for (let i = 0; i < base.length - 1; i += 1) {
    const start = base[i];
    const end = base[i + 1];

    for (let minute = 0; minute < 60; minute += 1) {
      const ratio = minute / 60;
      expanded.push(start + (end - start) * ratio);
    }
  }

  expanded.push(base[base.length - 1]);
  return expanded.slice(-minuteRange);
}

function aggregateByBucket(values, bucketSize, decimals) {
  const result = [];
  for (let i = 0; i < values.length; i += bucketSize) {
    const chunk = values.slice(i, i + bucketSize);
    result.push(round(average(chunk), decimals));
  }
  return result;
}

function buildMinuteLabels(count) {
  return Array.from({ length: count }, (_, idx) => {
    const remain = count - idx - 1;
    return remain === 0 ? "maint." : `-${remain}m`;
  });
}

function sliceFromEnd(labels, seriesList, takeCount) {
  const start = Math.max(0, labels.length - takeCount);
  return {
    labels: labels.slice(start),
    seriesList: seriesList.map((s) => ({
      nom: s.nom,
      couleur: s.couleur,
      valeurs: s.valeurs.slice(start)
    }))
  };
}

function ensureLongHistory(courbes, targetHours) {
  const baseLabels = courbes?.labels || [];
  const baseLen = baseLabels.length;
  if (baseLen >= targetHours) {
    return courbes;
  }

  const labels = Array.from({ length: targetHours }, (_, index) => {
    const day = Math.floor(index / 24) + 1;
    const hour = index % 24;
    return `J${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:00`;
  });

  function extendDataset(dataset, decimals) {
    const source = dataset?.valeurs || [];
    if (!source.length) {
      return { ...dataset, valeurs: [] };
    }

    const values = Array.from({ length: targetHours }, (_, index) => {
      const cycleValue = source[index % source.length];
      const wave = Math.sin(index * 0.09) * 0.6;
      return round(cycleValue + wave, decimals);
    });

    return { ...dataset, valeurs: values };
  }

  return {
    labels,
    temperature: (courbes?.temperature || []).map((dataset) => extendDataset(dataset, 2)),
    pression: (courbes?.pression || []).map((dataset) => extendDataset(dataset, 2)),
    puissance: (courbes?.puissance || []).map((dataset) => extendDataset(dataset, 1))
  };
}

function transformSeries(courbes, step, rangeValue, metricKey) {
  const enriched = ensureLongHistory(courbes, 24 * 7 * 12);
  const raw = enriched?.[metricKey] || [];
  const labels = enriched?.labels || [];

  if (!raw.length) {
    return { labels: [], seriesList: [] };
  }

  if (step === "hour") {
    return sliceFromEnd(labels, raw, rangeValue);
  }

  if (step === "minute") {
    const seriesList = raw.map((series) => ({
      nom: series.nom,
      couleur: series.couleur,
      valeurs: interpolateMinutes(series.valeurs || [], rangeValue).map((value) => round(value, 2))
    }));
    return { labels: buildMinuteLabels(rangeValue), seriesList };
  }

  if (step === "day") {
    const bucketSize = 24;
    const dayLabels = [];
    const totalDays = Math.ceil(labels.length / bucketSize);
    for (let i = 0; i < totalDays; i += 1) {
      dayLabels.push(`J${String(i + 1).padStart(2, "0")}`);
    }

    const seriesList = raw.map((series) => ({
      nom: series.nom,
      couleur: series.couleur,
      valeurs: aggregateByBucket(series.valeurs || [], bucketSize, 2)
    }));

    return sliceFromEnd(dayLabels, seriesList, rangeValue);
  }

  const bucketSize = 24 * 7;
  const weekLabels = [];
  const totalWeeks = Math.ceil(labels.length / bucketSize);
  for (let i = 0; i < totalWeeks; i += 1) {
    weekLabels.push(`S${String(i + 1).padStart(2, "0")}`);
  }

  const seriesList = raw.map((series) => ({
    nom: series.nom,
    couleur: series.couleur,
    valeurs: aggregateByBucket(series.valeurs || [], bucketSize, 2)
  }));

  return sliceFromEnd(weekLabels, seriesList, rangeValue);
}

function drawLineChart(canvasId, legendId, labels, datasets) {
  const canvas = document.getElementById(canvasId);
  const legend = document.getElementById(legendId);
  const ctx = canvas.getContext("2d");

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 640;
  const cssHeight = 220;
  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const width = cssWidth;
  const height = cssHeight;
  const pad = { top: 16, right: 16, bottom: 30, left: 44 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const allValues = datasets.flatMap((d) => d.valeurs);
  if (!allValues.length) {
    ctx.clearRect(0, 0, width, height);
    legend.textContent = "Aucune donnee";
    return;
  }

  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const span = maxVal - minVal || 1;
  const yMin = minVal - span * 0.12;
  const yMax = maxVal + span * 0.12;

  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;

  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (innerH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  const gridStep = Math.max(1, Math.ceil(labels.length / 10));
  for (let i = 0; i < labels.length; i += 1) {
    if (i % gridStep !== 0) {
      continue;
    }
    const x = pad.left + (innerW * i) / Math.max(labels.length - 1, 1);
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, height - pad.bottom);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255,255,255,0.62)";
  ctx.font = "11px Segoe UI";
  for (let i = 0; i <= 4; i += 1) {
    const value = yMax - ((yMax - yMin) * i) / 4;
    const y = pad.top + (innerH * i) / 4 + 4;
    ctx.fillText(value.toFixed(1), 6, y);
  }

  labels.forEach((label, idx) => {
    if (idx % gridStep !== 0 && idx !== labels.length - 1) {
      return;
    }
    const x = pad.left + (innerW * idx) / Math.max(labels.length - 1, 1);
    ctx.fillText(label, x - 14, height - 8);
  });

  datasets.forEach((series) => {
    ctx.strokeStyle = series.couleur;
    ctx.lineWidth = 2;
    ctx.beginPath();

    series.valeurs.forEach((value, idx) => {
      const x = pad.left + (innerW * idx) / Math.max(series.valeurs.length - 1, 1);
      const y = pad.top + ((yMax - value) / (yMax - yMin)) * innerH;

      if (idx === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();

    const markerStep = series.valeurs.length > 180 ? 5 : 1;
    series.valeurs.forEach((value, idx) => {
      if (idx % markerStep !== 0 && idx !== series.valeurs.length - 1) {
        return;
      }

      const x = pad.left + (innerW * idx) / Math.max(series.valeurs.length - 1, 1);
      const y = pad.top + ((yMax - value) / (yMax - yMin)) * innerH;

      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = series.couleur;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#0f1419";
      ctx.stroke();
    });
  });

  legend.innerHTML = "";
  datasets.forEach((series) => {
    const item = document.createElement("span");
    item.className = "legend-item";
    item.innerHTML = `<span class="legend-dot" style="background:${series.couleur}"></span>${series.nom}`;
    legend.appendChild(item);
  });
}

function renderCharts(eq) {
  const temp = transformSeries(eq.courbes, selectedStep, selectedRange, "temperature");
  const pressure = transformSeries(eq.courbes, selectedStep, selectedRange, "pression");
  const power = transformSeries(eq.courbes, selectedStep, selectedRange, "puissance");

  drawLineChart("tempChart", "tempLegend", temp.labels, temp.seriesList);
  drawLineChart("pressureChart", "pressureLegend", pressure.labels, pressure.seriesList);
  drawLineChart("powerChart", "powerLegend", power.labels, power.seriesList);
}

function renderPeriodButtons() {
  const options = RANGE_OPTIONS[selectedStep] || [];
  if (!options.includes(selectedRange)) {
    selectedRange = options[0];
  }

  periodFilter.innerHTML = "";
  options.forEach((value) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "period-btn period-range-btn";
    button.textContent = `${value}${RANGE_SUFFIX[selectedStep]}`;
    button.classList.toggle("is-active", value === selectedRange);
    button.addEventListener("click", () => {
      selectedRange = value;
      renderPeriodButtons();
      if (currentEquipment) {
        renderCharts(currentEquipment);
      }
    });
    periodFilter.appendChild(button);
  });
}

function setStep(step) {
  selectedStep = step;
  stepButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.step === selectedStep);
  });

  renderPeriodButtons();
  if (currentEquipment) {
    renderCharts(currentEquipment);
  }
}

function renderEquipment(eq) {
  currentEquipment = eq;
  titleEl.textContent = `${eq.nom} - Maintenance`;
  statusEl.textContent = `Statut: ${eq.statut}`;
  statusEl.className = `status-pill ${eq.statut}`;

  renderMainInfo(eq);
  renderMaintenance(eq);
  renderDocuments(eq);
  renderCharts(eq);
}

stepButtons.forEach((button) => {
  button.addEventListener("click", () => setStep(button.dataset.step));
});

window.addEventListener("resize", () => {
  if (currentEquipment) {
    renderCharts(currentEquipment);
  }
});

exitButton.addEventListener("click", () => {
  window.location.href = "index.html";
});

const equipment = getEquipmentFromQuery();
if (equipment) {
  sessionStorage.setItem(LAST_EQUIPMENT_KEY, equipment.id);
  renderPeriodButtons();
  renderEquipment(equipment);
}
