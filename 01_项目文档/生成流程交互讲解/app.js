(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const colorTotals = [
    [13, 265, 5, [33, 58, 58, 58, 58]],
    [28, 296, 6, [49, 50, 49, 49, 49, 50]],
    [30, 163, 3, [58, 47, 58]],
    [31, 147, 3, [58, 58, 31]],
    [32, 162, 3, [58, 46, 58]],
    [26, 153, 3, [58, 37, 58]],
    [1, 34, 1, [34]],
    [3, 47, 1, [47]],
    [15, 49, 1, [49]],
    [18, 54, 1, [54]],
    [19, 34, 1, [34]],
    [20, 52, 1, [52]],
    [24, 57, 1, [57]],
    [25, 45, 1, [45]],
    [27, 42, 1, [42]]
  ];

  const board = [
    [
      { color: 28, count: 49 },
      { color: 13, count: 33 },
      { color: 28, count: 50 },
      { color: 19, count: 34 },
      { color: 27, count: 42 },
      { color: 32, count: 58 },
      { color: 28, count: 49 }
    ],
    [
      { color: 31, count: 58 },
      { color: 28, count: 49 },
      { color: 31, count: 58 },
      { black: true },
      { color: 32, count: 46 },
      { black: true },
      { color: 32, count: 58, ice: 12 }
    ],
    [
      { black: true },
      { color: 1, count: 34, ice: 12 },
      { color: 25, count: 45 },
      { color: 30, count: 58 },
      { black: true },
      { color: 31, count: 31 },
      { color: 13, count: 58 }
    ],
    [
      { color: 13, count: 58 },
      { black: true },
      { color: 13, count: 58 },
      { black: true },
      { color: 30, count: 47, question: true },
      { color: 26, count: 58, ice: 11 },
      { color: 13, count: 58 }
    ],
    [
      { color: 20, count: 52, question: true },
      { color: 15, count: 49 },
      { color: 30, count: 58 },
      { color: 18, count: 54 },
      { black: true },
      { color: 3, count: 47 },
      { black: true }
    ],
    [
      { color: 28, count: 49, chain: 1 },
      { color: 24, count: 57, chain: 1 },
      { black: true },
      { color: 26, count: 37 },
      { black: true },
      { color: 26, count: 58 },
      { color: 28, count: 50 }
    ]
  ];

  const pickOrder = [
    [1, 0, 2, 28, 50],
    [2, 1, 2, 31, 58],
    [3, 0, 6, 28, 49],
    [4, 0, 0, 28, 49],
    [5, 0, 1, 13, 33],
    [6, 1, 0, 31, 58],
    [7, 1, 1, 28, 49],
    [8, 0, 3, 19, 34],
    [9, 2, 2, 25, 45],
    [10, 3, 2, 13, 58],
    [11, 2, 3, 30, 58],
    [12, 4, 2, 30, 58],
    [13, 4, 3, 18, 54],
    [14, 5, 3, 26, 37],
    [15, 1, 6, 32, 58],
    [16, 2, 6, 13, 58],
    [17, 3, 6, 13, 58],
    [18, 3, 5, 26, 58],
    [19, 0, 5, 32, 58],
    [20, 4, 1, 15, 49],
    [21, 2, 5, 31, 31],
    [22, 2, 1, 1, 34],
    [23, 4, 5, 3, 47],
    [24, 3, 4, 30, 47],
    [25, 5, 5, 26, 58],
    [26, 5, 6, 28, 50],
    [27, 0, 4, 27, 42],
    [28, 1, 4, 32, 46],
    [29, 4, 0, 20, 52],
    [30, 3, 0, 13, 58],
    [31, 5, 0, 28, 49],
    [31, 5, 1, 24, 57]
  ];

  const pressureSamples = [
    [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 4], [7, 4], [8, 3],
    [9, 4], [10, 4], [11, 4], [12, 3], [13, 3], [14, 3], [15, 2], [16, 2],
    [17, 2], [18, 3], [19, 2], [20, 2], [21, 3], [22, 2], [23, 2], [24, 2],
    [25, 3], [26, 4], [27, 3], [28, 4], [29, 3], [30, 2], [31, 1], [32, 0]
  ];

  const routeMap = new Map();
  pickOrder.forEach(([step, r, c, color, count]) => {
    routeMap.set(`${r}-${c}`, { step, color, count });
  });

  function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function colorFor(id) {
    return `hsl(${(id * 47) % 360} 68% 58%)`;
  }

  function cellLabel(cell) {
    if (cell.black) return "黑块";
    const parts = [`色 ${cell.color}`, `${cell.count} 球`];
    if (cell.ice) parts.push(`冰 ${cell.ice}`);
    if (cell.question) parts.push("问号");
    if (cell.chain) parts.push(`锁链组 ${cell.chain}`);
    return parts.join("，");
  }

  function buildBoard(container, mode) {
    if (!container) return;
    container.replaceChildren();
    board.flat().forEach((cell, index) => {
      const r = Math.floor(index / 7);
      const c = index % 7;
      const node = make("div", "case-cell");
      node.style.setProperty("--cell-color", colorFor(cell.color || 0));
      node.setAttribute("role", "img");
      node.setAttribute("aria-label", `第 ${r + 1} 行第 ${c + 1} 列，${cellLabel(cell)}`);

      if (cell.black) {
        node.classList.add("black");
        node.appendChild(make("span", "cell-center", "×"));
      } else {
        const route = routeMap.get(`${r}-${c}`);
        if (mode === "route") {
          node.classList.add("route");
          node.appendChild(make("strong", "step-number", String(route ? route.step : "·")));
          node.appendChild(make("small", "route-color", `色${cell.color}`));
        } else {
          node.appendChild(make("strong", "cell-color", String(cell.color)));
          node.appendChild(make("small", "cell-count", String(cell.count)));
        }

        if (cell.ice) {
          node.classList.add("has-ice");
          node.appendChild(make("span", "modifier ice-mod", `冰${cell.ice}`));
        }
        if (cell.question) {
          node.classList.add("has-question");
          node.appendChild(make("span", "modifier q-mod", "?"));
        }
        if (cell.chain) {
          node.classList.add("has-chain");
          node.appendChild(make("span", "modifier chain-mod", "链"));
        }
      }
      container.appendChild(node);
    });
  }

  function buildColorDemand() {
    const target = $("#color-demand-list");
    if (!target) return;
    colorTotals.forEach(([color, total, cars]) => {
      const row = make("div", "color-demand-row");
      const swatch = make("i");
      swatch.style.background = colorFor(color);
      const label = make("span", "", `色 ${color}`);
      const track = make("div", "mini-track");
      const fill = document.createElement("i");
      fill.style.width = `${Math.round(total / 296 * 100)}%`;
      fill.style.background = colorFor(color);
      track.appendChild(fill);
      const count = make("b", "", String(total));
      const carCount = make("small", "", `${cars} 辆`);
      row.append(swatch, label, track, count, carCount);
      target.appendChild(row);
    });
  }

  function buildManifest() {
    const target = $("#car-manifest");
    if (!target) return;
    colorTotals.forEach(([color, total, cars, capacities]) => {
      const row = make("div", "manifest-row");
      const head = make("div", "manifest-head");
      const swatch = make("i");
      swatch.style.background = colorFor(color);
      head.append(swatch, make("strong", "", `色 ${color}`), make("span", "", `${cars} 辆 · ${total} 球`));
      const tickets = make("div", "manifest-tickets");
      capacities.forEach((capacity) => {
        const ticket = make("span", "manifest-ticket", String(capacity));
        ticket.style.borderColor = colorFor(color);
        tickets.appendChild(ticket);
      });
      row.append(head, tickets);
      target.appendChild(row);
    });
  }

  function buildOpeningRow() {
    const target = $("#opening-row");
    if (!target) return;
    board[0].forEach((cell) => {
      const tile = make("div", "opening-car");
      tile.style.setProperty("--cell-color", colorFor(cell.color));
      tile.append(make("strong", "", String(cell.color)), make("span", "", String(cell.count)));
      target.appendChild(tile);
    });
  }

  function drawPressure() {
    const svg = $("#case-pressure");
    const line = $("#pressure-line-path");
    const area = $("#pressure-area-path");
    const marker = $(".release-point.actual");
    const label = $(".release-label.actual");
    if (!svg || !line || !area || !marker || !label) return;

    const left = 76;
    const right = 670;
    const top = 48;
    const bottom = 248;
    const xFor = (index) => left + index / (pressureSamples.length - 1) * (right - left);
    const yFor = (buffer) => bottom - buffer / 5 * (bottom - top);
    const points = pressureSamples.map(([, buffer], index) => [xFor(index), yFor(buffer)]);
    const linePath = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
    line.setAttribute("d", linePath);
    area.setAttribute("d", `${linePath} L${right} ${bottom} L${left} ${bottom} Z`);

    const releaseX = xFor(10);
    const releaseY = yFor(4);
    marker.setAttribute("cx", String(releaseX));
    marker.setAttribute("cy", String(releaseY));
    label.setAttribute("x", String(Math.min(releaseX + 12, right - 105)));
    label.setAttribute("y", String(releaseY - 12));
  }

  function buildJson() {
    const target = $("#case-json");
    if (!target) return;
    target.textContent = `{
  "toprow": 40,
  "blocks": [
    [13, 13, 13, 13, ...],
    [13, 30, 30, 30, ...],
    ...
  ],
  "maprow": 6,
  "mapcol": 7,
  "spools": [
    [
      { "id": 28, "count": 49, "type": 0, "param": 0 },
      { "id": 13, "count": 33, "type": 0, "param": 0 },
      { "id": 28, "count": 50, "type": 0, "param": 0 },
      ...
    ],
    ...
  ]
}`;
  }

  function setupScrollUI() {
    const bar = $("#read-progress-bar");
    const links = $$("[data-nav]");
    const sections = $$(".process-section");
    let queued = false;

    function update() {
      queued = false;
      const root = document.documentElement;
      const ratio = Math.max(0, Math.min(1, scrollY / Math.max(1, root.scrollHeight - innerHeight)));
      if (bar) bar.style.width = `${ratio * 100}%`;
      const anchor = scrollY + innerHeight * 0.38;
      let current = null;
      sections.forEach((section) => {
        if (section.offsetTop <= anchor) current = section;
      });
      links.forEach((link) => link.classList.toggle("is-current", !!current && link.dataset.nav === current.id));
    }

    addEventListener("scroll", () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    }, { passive: true });
    addEventListener("resize", update, { passive: true });
    update();
  }

  function setupPressureAnimation() {
    const section = $("#trace-7");
    const chart = $("#case-pressure");
    if (!section || !chart) return;
    if (!("IntersectionObserver" in window)) {
      section.classList.add("is-playing");
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          section.classList.add("is-playing");
          observer.disconnect();
        }
      });
    }, { threshold: 0.24 });
    observer.observe(section);
  }

  buildBoard($("#hero-case-board"), "compact");
  buildBoard($("#board-trace"), "board");
  buildBoard($("#obstacle-trace"), "obstacles");
  buildBoard($("#route-trace"), "route");
  buildColorDemand();
  buildManifest();
  buildOpeningRow();
  drawPressure();
  buildJson();
  setupScrollUI();
  setupPressureAnimation();
})();
