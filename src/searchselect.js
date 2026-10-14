// Turns a <select> into a type-to-search box. The select stays in the DOM and stays the source of truth,
// so existing code that reads select.value, sets it, or rebuilds its options keeps working.

const valueProp = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");

export function searchableSelect(select) {
  const wrap = document.createElement("div");
  wrap.className = "combo";
  const input = Object.assign(document.createElement("input"), { type: "search", autocomplete: "off" });
  input.setAttribute("role", "combobox");
  const menu = Object.assign(document.createElement("ul"), { className: "menu hidden" });
  select.before(wrap);
  wrap.append(input, menu, select);
  select.classList.add("hidden");

  let typing = false;
  let items = [];
  let index = 0;

  function sync() {
    const chosen = select.selectedOptions[0];
    input.value = chosen && chosen.value ? chosen.textContent : "";
    input.placeholder = select.options[0]?.textContent ?? "";
    input.disabled = select.disabled;
    typing = false;
  }

  function render() {
    const words = (typing ? input.value : "").toLowerCase().split(/\s+/).filter(Boolean);
    items = [...select.options].filter((o) => words.every((w) => o.textContent.toLowerCase().includes(w))).slice(0, 80);
    index = 0;
    menu.replaceChildren(
      ...(items.length
        ? items.map((o, i) => {
            const li = Object.assign(document.createElement("li"), { role: "option" });
            li.setAttribute("aria-selected", String(i === index));
            li.append(Object.assign(document.createElement("div"), { className: "t", textContent: o.textContent }));
            li.addEventListener("mousedown", (e) => {
              e.preventDefault();
              pick(o.value);
            });
            return li;
          })
        : [Object.assign(document.createElement("li"), { className: "empty", textContent: "No matches" })]),
    );
    menu.classList.remove("hidden");
  }

  function highlight(i) {
    index = (i + items.length) % items.length;
    [...menu.children].forEach((li, n) => li.setAttribute("aria-selected", String(n === index)));
    menu.children[index]?.scrollIntoView({ block: "nearest" });
  }

  function pick(value) {
    valueProp.set.call(select, value);
    sync();
    menu.classList.add("hidden");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  input.addEventListener("focus", () => {
    input.select();
    render();
  });
  input.addEventListener("input", () => {
    typing = true;
    render();
  });
  input.addEventListener("blur", () => {
    menu.classList.add("hidden");
    sync();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (menu.classList.contains("hidden")) render();
      else if (items.length) highlight(index + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter" && !menu.classList.contains("hidden")) {
      e.preventDefault();
      if (items[index]) pick(items[index].value);
    } else if (e.key === "Escape") {
      menu.classList.add("hidden");
      sync();
    }
  });

  // Keep the box in step with code that changes the select behind our back.
  Object.defineProperty(select, "value", {
    configurable: true,
    get() {
      return valueProp.get.call(this);
    },
    set(v) {
      valueProp.set.call(this, v);
      sync();
    },
  });
  new MutationObserver(sync).observe(select, { childList: true, attributes: true, attributeFilter: ["disabled"] });
  sync();
}
