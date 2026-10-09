// A small calendar popover for a text input holding "YYYY-MM-DD". Fires "change" on the input when a day is picked.

import { isoDate, addDays } from "./time.js";

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export function attachDatePicker(input) {
  const host = input.closest(".row") ?? input.parentElement;
  host.style.position = "relative";
  const pop = document.createElement("div");
  pop.className = "datepop hidden";
  host.append(pop);
  let view; // first of the month being shown

  const pick = (iso) => {
    input.value = iso;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  };
  const close = () => pop.classList.add("hidden");
  const open = () => {
    const [y, m] = (input.value || isoDate()).split("-").map(Number);
    view = new Date(y, m - 1, 1);
    render();
    pop.classList.remove("hidden");
  };

  function render() {
    const today = isoDate();
    const first = view.getDay() === 0 ? 6 : view.getDay() - 1; // Monday-first
    const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    const cells = Array.from({ length: first }, () => `<i></i>`);
    for (let d = 1; d <= days; d++) {
      const iso = isoDate(new Date(view.getFullYear(), view.getMonth(), d));
      const cls = [iso === input.value && "sel", iso === today && "today"].filter(Boolean).join(" ");
      cells.push(`<button type="button" class="${cls}" data-iso="${iso}">${d}</button>`);
    }
    pop.innerHTML = `
      <div class="dp-head">
        <button type="button" data-nav="-1" aria-label="Previous month">‹</button>
        <b>${view.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</b>
        <button type="button" data-nav="1" aria-label="Next month">›</button>
      </div>
      <div class="dp-grid">${DAYS.map((d) => `<span>${d}</span>`).join("")}${cells.join("")}</div>
      <div class="dp-foot">
        <button type="button" data-iso="${today}">Today</button>
        <button type="button" data-iso="${addDays(today, -1)}">Yesterday</button>
      </div>`;
  }

  pop.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.iso) return pick(b.dataset.iso);
    view = new Date(view.getFullYear(), view.getMonth() + Number(b.dataset.nav), 1);
    render();
  });
  input.addEventListener("click", () => (pop.classList.contains("hidden") ? open() : close()));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    } else if (e.key === "Escape") close();
  });
  document.addEventListener("click", (e) => {
    if (!pop.contains(e.target) && e.target !== input) close();
  });
}
