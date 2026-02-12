const data = window.SUPERVISION_DATA?.equipments || [];
const layer = document.getElementById("pointsLayer");
const tooltip = document.getElementById("tooltip");
const LAST_EQUIPMENT_KEY = "lastEquipmentId";

function showTooltip(eq, x, y) {
  tooltip.textContent = `${eq.nom} (${eq.statut})`;
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
  tooltip.classList.remove("hidden");
}

function hideTooltip() {
  tooltip.classList.add("hidden");
}

function goToEquipment(eqId) {
  sessionStorage.setItem(LAST_EQUIPMENT_KEY, eqId);
  window.location.href = `equipment.html?id=${encodeURIComponent(eqId)}`;
}

data.forEach((eq) => {
  const el = document.createElement("div");
  el.className = `point ${eq.statut}`;
  el.style.left = eq.left;
  el.style.top = eq.top;
  el.dataset.equipmentId = eq.id;

  el.addEventListener("mouseenter", (event) => {
    const rect = layer.getBoundingClientRect();
    showTooltip(eq, event.clientX - rect.left, event.clientY - rect.top);
  });

  el.addEventListener("mousemove", (event) => {
    const rect = layer.getBoundingClientRect();
    showTooltip(eq, event.clientX - rect.left, event.clientY - rect.top);
  });

  el.addEventListener("mouseleave", hideTooltip);

  el.addEventListener("click", () => {
    hideTooltip();
    goToEquipment(eq.id);
  });

  layer.appendChild(el);
});

const lastEquipmentId = sessionStorage.getItem(LAST_EQUIPMENT_KEY);
if (lastEquipmentId) {
  const lastPoint = layer.querySelector(`[data-equipment-id="${lastEquipmentId}"]`);
  if (lastPoint) {
    lastPoint.classList.add("selected");
  }
}
