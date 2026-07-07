/* ============================================================
 * 有向數貪食蛇 Math Snake — 連續答題模式
 * 上方出現有向數算式，操控小蛇吃掉正確答案的果實：
 * 答對加分、答錯扣分且蛇身變長；不定時出現神奇道具。
 * ============================================================ */

(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  // ---------- 棋盤參數 ----------
  const COLS = 21;
  const ROWS = 15;
  const CELL = 36;                    // 與 index.html 的 viewBox 756x540 對應
  const TOKEN_COUNT = 6;              // 場上答案果實數（1 正確 + 5 干擾）
  const NL_RANGE = 15;                // 數軸顯示 -15 ~ +15

  // ---------- 難度 ----------
  const DIFFS = {
    easy:   { label: "簡單", tick: 200 },
    medium: { label: "中等", tick: 170 },
    hard:   { label: "困難", tick: 148 },
  };

  // ---------- 道具 ----------
  const ITEM_TYPES = {
    ghost:  { icon: "🌀", label: "穿牆術", dur: 10000 },
    slow:   { icon: "⏰", label: "慢動作", dur: 8000 },
    shrink: { icon: "🍄", label: "縮小菇", dur: 0 },
  };
  const ITEM_LIFETIME = 12000;        // 道具在場上的存活時間
  const SLOW_FACTOR = 1.6;

  // ---------- DOM ----------
  const groundLayer = document.getElementById("groundLayer");
  const tokenLayer  = document.getElementById("tokenLayer");
  const itemLayer   = document.getElementById("itemLayer");
  const snakeLayer  = document.getElementById("snakeLayer");
  const fxLayer     = document.getElementById("fxLayer");
  const numberline  = document.getElementById("numberline");
  const boardFrame  = document.getElementById("boardFrame");

  const hudDiff    = document.getElementById("hudDiff");
  const hudScore   = document.getElementById("hudScore");
  const hudCorrect = document.getElementById("hudCorrect");
  const hudCombo   = document.getElementById("hudCombo");
  const hudItem    = document.getElementById("hudItem");
  const questionEl = document.getElementById("question");

  const overlay  = document.getElementById("overlay");
  const pageMenu = document.getElementById("pageMenu");
  const pageHow  = document.getElementById("pageHow");
  const pageOver = document.getElementById("pageOver");
  const overTitle = document.getElementById("overTitle");
  const overBody  = document.getElementById("overBody");

  // ---------- 遊戲狀態 ----------
  const DIRS = {
    up:    { x: 0,  y: -1 },
    down:  { x: 0,  y: 1 },
    left:  { x: -1, y: 0 },
    right: { x: 1,  y: 0 },
  };

  let diffKey = "easy";
  let snake = [];            // [{x,y}]，index 0 為蛇頭
  let dir = DIRS.right;
  let queuedDirs = [];
  let growPending = 0;       // 待增長節數（答錯懲罰 / 答對成長）
  let tokens = [];           // [{x,y,value,el}]
  let question = null;       // { html, text, answer }
  let boardItem = null;      // 場上道具 {x,y,type,el,expireAt}
  let nextItemAt = 0;
  let effects = { ghost: 0, slow: 0 };   // 生效中的道具（到期時間戳）
  let score = 0;
  let correct = 0;
  let wrong = 0;
  let combo = 0;
  let tickMs = 200;
  let timer = null;
  let running = false;
  let paused = false;

  // ---------- 工具 ----------
  const randInt = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const now = () => performance.now();

  function el(name, attrs = {}, parent = null) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  function fmt(n) { return n > 0 ? `+${n}` : `${n}`; }
  function fmtHtml(n) {
    const cls = n > 0 ? "pos" : n < 0 ? "neg" : "";
    return `<span class="${cls}">(${fmt(n)})</span>`;
  }

  // ---------- 音效（Web Audio 簡易合成） ----------
  let audioCtx = null;
  function beep(freq, dur = 0.12, type = "sine", gain = 0.15) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(gain, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      osc.connect(g).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + dur);
    } catch (_) { /* 靜音環境忽略 */ }
  }
  const sfx = {
    right: () => { beep(660, 0.1, "triangle"); setTimeout(() => beep(988, 0.14, "triangle"), 90); },
    wrongA: () => { beep(220, 0.18, "sawtooth", 0.12); setTimeout(() => beep(165, 0.22, "sawtooth", 0.12), 120); },
    item:  () => { [784, 988, 1319].forEach((f, i) => setTimeout(() => beep(f, 0.1, "sine", 0.12), i * 70)); },
    crash: () => { beep(150, 0.3, "sawtooth", 0.2); },
  };

  // ============================================================
  // 草地
  // ============================================================
  function drawGround() {
    groundLayer.innerHTML = "";
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        el("rect", {
          x: x * CELL, y: y * CELL, width: CELL, height: CELL,
          fill: (x + y) % 2 === 0 ? "url(#grassA)" : "url(#grassB)",
        }, groundLayer);
      }
    }
    el("rect", {
      x: 0, y: 0, width: COLS * CELL, height: ROWS * CELL,
      fill: "none", stroke: "rgba(20,50,5,0.35)", "stroke-width": 10,
    }, groundLayer);
  }

  // ============================================================
  // 出題（依難度）
  // ============================================================
  function nz(lo, hi) { let v = 0; while (v === 0) v = randInt(lo, hi); return v; }

  function makeQuestion() {
    let terms, ops;   // terms: 數字陣列, ops: 每兩數之間的運算 "+"|"−"|"×"|"÷"

    if (diffKey === "easy") {
      terms = [nz(-9, 9), nz(-9, 9)];
      ops = [pick(["+", "−"])];
    } else if (diffKey === "medium") {
      terms = [nz(-12, 12), nz(-12, 12), nz(-12, 12)];
      ops = [pick(["+", "−"]), pick(["+", "−"])];
    } else {
      const kind = pick(["mul", "div", "mix"]);
      if (kind === "mul") {
        terms = [nz(-9, 9), nz(-9, 9)];
        ops = ["×"];
      } else if (kind === "div") {
        const q = nz(-9, 9), d = nz(-9, 9);
        terms = [q * d, d];
        ops = ["÷"];
      } else {
        terms = [nz(-6, 6), nz(-6, 6), nz(-12, 12)];
        ops = ["×", pick(["+", "−"])];
      }
    }

    // 依先乘除後加減計算答案
    const vals = terms.slice();
    const opList = ops.slice();
    for (let i = 0; i < opList.length; ) {
      if (opList[i] === "×" || opList[i] === "÷") {
        vals.splice(i, 2, opList[i] === "×" ? vals[i] * vals[i + 1] : vals[i] / vals[i + 1]);
        opList.splice(i, 1);
      } else i++;
    }
    let ans = vals[0];
    for (let i = 0; i < opList.length; i++) {
      ans = opList[i] === "+" ? ans + vals[i + 1] : ans - vals[i + 1];
    }

    const text = terms.map((t, i) => (i === 0 ? `(${fmt(t)})` : ` ${ops[i - 1]} (${fmt(t)})`)).join("");
    const html = terms.map((t, i) => (i === 0 ? fmtHtml(t) : ` ${ops[i - 1]} ${fmtHtml(t)}`)).join("");
    return { text, html, answer: ans };
  }

  function makeDistractors(ans, count) {
    const set = new Set();
    const candidates = [];
    for (const d of [1, 2, 3, 10]) { candidates.push(ans + d, ans - d); }
    if (ans !== 0) candidates.push(-ans);
    while (candidates.length < count * 3) candidates.push(ans + randInt(-12, 12));
    for (const c of candidates) {
      if (c !== ans && !set.has(c)) set.add(c);
    }
    const arr = [...set];
    // 洗牌後取前 count 個
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, count);
  }

  function newQuestion() {
    question = makeQuestion();
    questionEl.innerHTML = `${question.html} = <b>?</b>`;
    respawnTokens();
  }

  // ============================================================
  // 答案果實：正數 → 蘋果、負數 → 藍莓、零 → 檸檬
  // ============================================================
  function makeTokenEl(token) {
    const cx = token.x * CELL + CELL / 2;
    const cy = token.y * CELL + CELL / 2;
    const g = el("g", { filter: "url(#tinyShadow)" });
    const inner = el("g", { class: "token-bob" }, g);
    inner.style.transformOrigin = `${cx}px ${cy}px`;

    const r = CELL * 0.42;

    if (token.value > 0) {
      el("circle", { cx: cx - r * 0.28, cy, r: r * 0.82, fill: "url(#appleGrad)" }, inner);
      el("circle", { cx: cx + r * 0.28, cy, r: r * 0.82, fill: "url(#appleGrad)" }, inner);
      el("path", {
        d: `M ${cx} ${cy - r * 0.7} q -2 -7 2 -11`,
        stroke: "#6b4a1d", "stroke-width": 3, fill: "none", "stroke-linecap": "round",
      }, inner);
      el("path", {
        d: `M ${cx + 2} ${cy - r * 1.02} q 10 -6 14 2 q -9 6 -14 -2 Z`,
        fill: "#4e9427",
      }, inner);
      el("ellipse", {
        cx: cx - r * 0.42, cy: cy - r * 0.38, rx: r * 0.26, ry: r * 0.16,
        fill: "rgba(255,255,255,0.65)", transform: `rotate(-28 ${cx - r * 0.42} ${cy - r * 0.38})`,
      }, inner);
    } else if (token.value < 0) {
      el("circle", { cx, cy, r, fill: "url(#berryGrad)" }, inner);
      const star = [];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 === 0 ? 4.5 : 2;
        star.push(`${cx + Math.cos(a) * rr},${cy - r * 0.62 + Math.sin(a) * rr}`);
      }
      el("polygon", { points: star.join(" "), fill: "#22307f", opacity: 0.9 }, inner);
      el("ellipse", {
        cx: cx - r * 0.36, cy: cy - r * 0.36, rx: r * 0.24, ry: r * 0.15,
        fill: "rgba(255,255,255,0.55)", transform: `rotate(-30 ${cx - r * 0.36} ${cy - r * 0.36})`,
      }, inner);
    } else {
      // 檸檬（零）
      el("ellipse", { cx, cy, rx: r * 1.05, ry: r * 0.8, fill: "url(#lemonGrad)" }, inner);
      el("ellipse", { cx: cx + r * 1.0, cy, rx: r * 0.14, ry: r * 0.1, fill: "#c9a22a" }, inner);
      el("ellipse", {
        cx: cx - r * 0.4, cy: cy - r * 0.3, rx: r * 0.28, ry: r * 0.14,
        fill: "rgba(255,255,255,0.6)", transform: `rotate(-24 ${cx - r * 0.4} ${cy - r * 0.3})`,
      }, inner);
    }

    const label = fmt(token.value).replace("+0", "0");
    el("text", {
      x: cx, y: cy + 5.5,
      "text-anchor": "middle",
      "font-size": label.length <= 2 ? 15 : label.length === 3 ? 12.5 : 11,
      "font-weight": 800,
      "font-family": "inherit",
      fill: "#fff",
      stroke: "rgba(0,0,0,0.35)",
      "stroke-width": 2.6,
      "paint-order": "stroke",
    }, inner).textContent = label;

    return g;
  }

  function occupied(x, y) {
    return snake.some(s => s.x === x && s.y === y) ||
           tokens.some(t => t.x === x && t.y === y) ||
           (boardItem && boardItem.x === x && boardItem.y === y);
  }

  function freeCell() {
    let x, y, tries = 0;
    do {
      x = randInt(1, COLS - 2);
      y = randInt(1, ROWS - 2);
      tries++;
    } while (occupied(x, y) && tries < 400);
    return tries < 400 ? { x, y } : null;
  }

  function spawnToken(value) {
    const cell = freeCell();
    if (!cell) return;
    const token = { ...cell, value };
    token.el = makeTokenEl(token);
    tokenLayer.appendChild(token.el);
    tokens.push(token);
  }

  function respawnTokens() {
    tokens.forEach(t => t.el.remove());
    tokens = [];
    const values = [question.answer, ...makeDistractors(question.answer, TOKEN_COUNT - 1)];
    values.forEach(v => spawnToken(v));
  }

  // ============================================================
  // 道具
  // ============================================================
  function makeItemEl(item) {
    const cx = item.x * CELL + CELL / 2;
    const cy = item.y * CELL + CELL / 2;
    const g = el("g", { filter: "url(#itemGlow)" });
    const inner = el("g", { class: "token-bob" }, g);
    inner.style.transformOrigin = `${cx}px ${cy}px`;
    const r = CELL * 0.42;

    if (item.type === "ghost") {
      // 旋渦傳送門
      el("circle", { cx, cy, r, fill: "url(#portalGrad)" }, inner);
      el("path", {
        d: `M ${cx - r * 0.55} ${cy} a ${r * 0.55} ${r * 0.55} 0 1 1 ${r * 0.55} ${r * 0.55}`,
        stroke: "#e8d9ff", "stroke-width": 2.6, fill: "none", "stroke-linecap": "round",
      }, inner);
      el("path", {
        d: `M ${cx + r * 0.3} ${cy - r * 0.1} a ${r * 0.3} ${r * 0.3} 0 1 1 -${r * 0.3} ${r * 0.3}`,
        stroke: "#c3a6f5", "stroke-width": 2, fill: "none", "stroke-linecap": "round",
      }, inner);
      el("circle", { cx, cy, r: 2.4, fill: "#fff" }, inner);
    } else if (item.type === "slow") {
      // 時鐘
      el("circle", { cx, cy, r, fill: "#8a5527" }, inner);
      el("circle", { cx, cy, r: r * 0.82, fill: "url(#clockGrad)" }, inner);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        el("line", {
          x1: cx + Math.cos(a) * r * 0.68, y1: cy + Math.sin(a) * r * 0.68,
          x2: cx + Math.cos(a) * r * 0.78, y2: cy + Math.sin(a) * r * 0.78,
          stroke: "#5c4a24", "stroke-width": i % 3 === 0 ? 2 : 1,
        }, inner);
      }
      el("line", { x1: cx, y1: cy, x2: cx, y2: cy - r * 0.5, stroke: "#3c2f12", "stroke-width": 2.6, "stroke-linecap": "round" }, inner);
      el("line", { x1: cx, y1: cy, x2: cx + r * 0.38, y2: cy + r * 0.12, stroke: "#3c2f12", "stroke-width": 2, "stroke-linecap": "round" }, inner);
      el("circle", { cx, cy, r: 2, fill: "#3c2f12" }, inner);
    } else {
      // 縮小蘑菇
      el("path", {
        d: `M ${cx - r} ${cy + r * 0.1} a ${r} ${r} 0 0 1 ${r * 2} 0 Z`,
        fill: "url(#mushGrad)",
      }, inner);
      el("rect", {
        x: cx - r * 0.32, y: cy + r * 0.05, width: r * 0.64, height: r * 0.7,
        rx: r * 0.2, fill: "#f2e8cf", stroke: "#c9b384", "stroke-width": 1,
      }, inner);
      el("circle", { cx: cx - r * 0.45, cy: cy - r * 0.25, r: r * 0.16, fill: "#fff" }, inner);
      el("circle", { cx: cx + r * 0.1,  cy: cy - r * 0.45, r: r * 0.13, fill: "#fff" }, inner);
      el("circle", { cx: cx + r * 0.5,  cy: cy - r * 0.18, r: r * 0.14, fill: "#fff" }, inner);
    }
    return g;
  }

  function scheduleNextItem() {
    nextItemAt = now() + randInt(9000, 16000);
  }

  function maybeSpawnItem() {
    const t = now();
    if (boardItem) {
      if (t > boardItem.expireAt) {
        boardItem.el.remove();
        boardItem = null;
        scheduleNextItem();
      } else if (t > boardItem.expireAt - 3000) {
        boardItem.el.classList.add("item-fading");
      }
      return;
    }
    if (t < nextItemAt) return;
    const cell = freeCell();
    if (!cell) return;
    const type = pick(Object.keys(ITEM_TYPES));
    boardItem = { ...cell, type, expireAt: t + ITEM_LIFETIME };
    boardItem.el = makeItemEl(boardItem);
    itemLayer.appendChild(boardItem.el);
  }

  function applyItem(type) {
    const info = ITEM_TYPES[type];
    sfx.item();
    if (type === "shrink") {
      const cut = Math.min(3, snake.length - 3);
      if (cut > 0) snake.splice(snake.length - cut, cut);
      growPending = 0;
    } else {
      effects[type] = now() + info.dur;
      if (type === "ghost") boardFrame.classList.add("ghost");
    }
    popFx(snake[0].x, snake[0].y, `${info.icon} ${info.label}！`, "#fff8c8", "#7a5a10");
  }

  function updateEffects() {
    const t = now();
    if (effects.ghost && t > effects.ghost) {
      effects.ghost = 0;
      boardFrame.classList.remove("ghost");
    }
    if (effects.slow && t > effects.slow) effects.slow = 0;

    // HUD 道具顯示
    const active = [];
    if (effects.ghost) active.push(`🌀${Math.ceil((effects.ghost - t) / 1000)}s`);
    if (effects.slow)  active.push(`⏰${Math.ceil((effects.slow - t) / 1000)}s`);
    hudItem.textContent = active.length ? active.join(" ") : "—";
    hudItem.classList.toggle("item-active", active.length > 0);
    snakeLayer.setAttribute("opacity", effects.ghost ? 0.7 : 1);
  }

  // ============================================================
  // 蛇（重疊漸層圓 + 菱形斑紋 + 立體蛇頭）
  // ============================================================
  function drawSnake() {
    snakeLayer.innerHTML = "";
    const n = snake.length;
    const body = el("g", { filter: "url(#softShadow)" }, snakeLayer);

    for (let i = n - 1; i >= 1; i--) {
      const seg = snake[i];
      const t = i / Math.max(n - 1, 1);
      const r = CELL * (0.46 - 0.18 * t);
      const cx = seg.x * CELL + CELL / 2;
      const cy = seg.y * CELL + CELL / 2;
      el("circle", { cx, cy, r, fill: "url(#bodyGrad)" }, body);
      if (i % 2 === 0 && r > 8) {
        const d = r * 0.5;
        el("path", {
          d: `M ${cx} ${cy - d} L ${cx + d} ${cy} L ${cx} ${cy + d} L ${cx - d} ${cy} Z`,
          fill: "rgba(30,70,15,0.5)",
        }, body);
      }
    }

    drawHead(body);
  }

  function drawHead(parent) {
    const head = snake[0];
    const cx = head.x * CELL + CELL / 2;
    const cy = head.y * CELL + CELL / 2;
    const angle = Math.atan2(dir.y, dir.x) * 180 / Math.PI;

    const g = el("g", { transform: `translate(${cx} ${cy}) rotate(${angle})` }, parent);
    const R = CELL * 0.52;

    const tongue = el("g", { class: "tongue" }, g);
    el("path", {
      d: `M ${R * 0.9} 0 L ${R * 1.5} 0 M ${R * 1.5} 0 L ${R * 1.85} -4 M ${R * 1.5} 0 L ${R * 1.85} 4`,
      stroke: "#d6274b", "stroke-width": 2.6, fill: "none", "stroke-linecap": "round",
    }, tongue);

    el("ellipse", { cx: 0, cy: 0, rx: R * 1.12, ry: R * 0.92, fill: "url(#headGrad)" }, g);
    el("ellipse", {
      cx: -R * 0.2, cy: -R * 0.34, rx: R * 0.5, ry: R * 0.22,
      fill: "rgba(255,255,255,0.28)",
    }, g);

    el("circle", { cx: R * 0.78, cy: -R * 0.18, r: 1.7, fill: "#1e3d10" }, g);
    el("circle", { cx: R * 0.78, cy:  R * 0.18, r: 1.7, fill: "#1e3d10" }, g);

    for (const side of [-1, 1]) {
      el("ellipse", { cx: R * 0.3, cy: side * R * 0.46, rx: R * 0.3, ry: R * 0.28, fill: "#f7f4e0" }, g);
      el("ellipse", { cx: R * 0.36, cy: side * R * 0.46, rx: R * 0.1, ry: R * 0.2, fill: "#1c2a0d" }, g);
      el("circle",  { cx: R * 0.32, cy: side * R * 0.46 - 2.5, r: 1.6, fill: "#fff" }, g);
    }
  }

  // ============================================================
  // 數軸（顯示上一題正確答案的位置）
  // ============================================================
  const NL = { w: 756, h: 84, pad: 26, y: 50 };
  const nlX = v => NL.pad + ((v + NL_RANGE) / (2 * NL_RANGE)) * (NL.w - NL.pad * 2);
  const clampNL = v => Math.max(-NL_RANGE, Math.min(NL_RANGE, v));
  let lastAnswer = 0;

  function drawNumberline() {
    numberline.innerHTML = "";

    el("line", {
      x1: NL.pad - 12, y1: NL.y, x2: NL.w - NL.pad + 12, y2: NL.y,
      stroke: "#5c4a24", "stroke-width": 3, "stroke-linecap": "round",
    }, numberline);
    el("path", { d: `M ${NL.w - NL.pad + 12} ${NL.y} l -9 -5 v 10 Z`, fill: "#5c4a24" }, numberline);
    el("path", { d: `M ${NL.pad - 12} ${NL.y} l 9 -5 v 10 Z`, fill: "#5c4a24" }, numberline);

    for (let v = -NL_RANGE; v <= NL_RANGE; v++) {
      const x = nlX(v);
      const major = v % 5 === 0;
      el("line", {
        x1: x, y1: NL.y - (major ? 8 : 5), x2: x, y2: NL.y + (major ? 8 : 5),
        stroke: v === 0 ? "#3c7a1e" : "#5c4a24", "stroke-width": major ? 2.4 : 1.4,
      }, numberline);
      if (major) {
        el("text", {
          x, y: NL.y + 24, "text-anchor": "middle", "font-size": 13, "font-weight": 700,
          fill: v > 0 ? "#b03a28" : v < 0 ? "#3a49ad" : "#3c7a1e",
        }, numberline).textContent = fmt(v).replace("+0", "0");
      }
    }

    el("text", {
      x: NL.pad, y: 14, "font-size": 11, "font-weight": 700, fill: "#8a713d",
    }, numberline).textContent = "上一題答案的位置：";

    const marker = el("g", { id: "nlMarker" }, numberline);
    el("ellipse", { cx: 0, cy: 0, rx: 11, ry: 9, fill: "url(#headGrad)", filter: "url(#tinyShadow)" }, marker);
    el("circle", { cx: 3.5, cy: -3, r: 2.6, fill: "#f7f4e0" }, marker);
    el("circle", { cx: 4.2, cy: -3, r: 1.2, fill: "#1c2a0d" }, marker);
    el("circle", { cx: 3.5, cy: 3, r: 2.6, fill: "#f7f4e0" }, marker);
    el("circle", { cx: 4.2, cy: 3, r: 1.2, fill: "#1c2a0d" }, marker);
    el("path", { d: "M 0 14 l -5 6 h 10 Z", fill: "#5c4a24" }, marker);
    updateNlMarker();
  }

  function updateNlMarker() {
    const marker = document.getElementById("nlMarker");
    if (marker) marker.style.transform = `translate(${nlX(clampNL(lastAnswer))}px, ${NL.y - 22}px)`;
  }

  // ============================================================
  // HUD / 特效
  // ============================================================
  function updateHud(bump) {
    hudDiff.textContent = DIFFS[diffKey].label;
    hudScore.textContent = score;
    hudCorrect.textContent = correct;
    hudCombo.textContent = combo;
    if (bump) {
      const box = bump === "score" ? hudScore : hudCombo;
      box.classList.add("bump");
      setTimeout(() => box.classList.remove("bump"), 380);
    }
  }

  function popFx(x, y, text, fill, strokeCol) {
    const cx = x * CELL + CELL / 2;
    const cy = y * CELL + CELL / 2;
    const t = el("text", {
      x: cx, y: cy - 6,
      class: "fx-pop",
      "text-anchor": "middle",
      "font-size": 20,
      fill, stroke: strokeCol,
      "stroke-width": 3.2,
      "paint-order": "stroke",
    }, fxLayer);
    t.textContent = text;
    t.style.transformOrigin = `${cx}px ${cy}px`;
    setTimeout(() => t.remove(), 950);
  }

  // ============================================================
  // 遊戲流程
  // ============================================================
  function showPage(page) {
    [pageMenu, pageHow, pageOver].forEach(p => p.classList.toggle("hidden", p !== page));
    overlay.classList.toggle("hidden", page === null);
  }

  function startGame() {
    score = 0; correct = 0; wrong = 0; combo = 0;
    growPending = 0;
    effects = { ghost: 0, slow: 0 };
    boardFrame.classList.remove("ghost");
    lastAnswer = 0;

    const cy = Math.floor(ROWS / 2);
    snake = [{ x: 5, y: cy }, { x: 4, y: cy }, { x: 3, y: cy }];
    dir = DIRS.right;
    queuedDirs = [];

    if (boardItem) { boardItem.el.remove(); boardItem = null; }
    scheduleNextItem();

    tickMs = DIFFS[diffKey].tick;
    newQuestion();
    drawNumberline();
    drawSnake();
    updateHud();
    updateEffects();

    showPage(null);
    running = true;
    paused = false;
    clearTimeout(timer);
    loop();
  }

  function gameOver(reason) {
    running = false;
    clearTimeout(timer);
    sfx.crash();
    boardFrame.classList.remove("ghost");

    const total = correct + wrong;
    const acc = total > 0 ? Math.round((correct / total) * 100) : 0;
    overTitle.textContent = "💥 遊戲結束";
    overBody.innerHTML = `
      <p>${reason}</p>
      <p>最終分數：<b class="big-num">${score}</b></p>
      <p>答對 <b class="pos">${correct}</b> 題 ・ 答錯 <b class="neg">${wrong}</b> 題 ・ 正確率 <b>${acc}%</b></p>
      <p class="hint">小提醒：先算好答案再出發，規劃最短又安全的路線！</p>`;
    showPage(pageOver);
  }

  // ============================================================
  // 主迴圈（setTimeout 鏈，方便慢動作道具動態調速）
  // ============================================================
  function loop() {
    if (!running) return;
    tick();
    const interval = tickMs * (effects.slow ? SLOW_FACTOR : 1);
    timer = setTimeout(loop, interval);
  }

  function tick() {
    if (paused) return;

    updateEffects();
    maybeSpawnItem();

    if (queuedDirs.length) dir = queuedDirs.shift();

    const head = snake[0];
    let nx = head.x + dir.x;
    let ny = head.y + dir.y;

    // 撞牆／穿牆
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
      if (effects.ghost) {
        nx = (nx + COLS) % COLS;
        ny = (ny + ROWS) % ROWS;
      } else {
        gameOver("小蛇撞到圍欄了！");
        return;
      }
    }

    // 撞到自己（尾巴這回合若會前進則排除最後一節）
    const tailMoves = growPending === 0;
    if (snake.some((s, i) => (!tailMoves || i < snake.length - 1) && s.x === nx && s.y === ny)) {
      gameOver("小蛇咬到自己的身體了！");
      return;
    }

    snake.unshift({ x: nx, y: ny });
    if (growPending > 0) growPending--;
    else snake.pop();

    // 吃到道具
    if (boardItem && boardItem.x === nx && boardItem.y === ny) {
      const type = boardItem.type;
      boardItem.el.remove();
      boardItem = null;
      scheduleNextItem();
      applyItem(type);
    }

    // 吃到答案果實
    const hit = tokens.findIndex(t => t.x === nx && t.y === ny);
    if (hit >= 0) {
      const token = tokens[hit];
      token.el.remove();
      tokens.splice(hit, 1);

      if (token.value === question.answer) {
        combo++;
        correct++;
        const pts = 20 + (combo - 1) * 5;
        score += pts;
        growPending += 1;
        lastAnswer = token.value;
        sfx.right();
        popFx(nx, ny, `答對！+${pts}`, "#d8ffc2", "#2e611a");
        updateNlMarker();
        // 每答對 5 題加速一點
        if (correct % 5 === 0) tickMs = Math.max(95, tickMs - 10);
        newQuestion();
        updateHud("combo");
      } else {
        wrong++;
        combo = 0;
        score = Math.max(0, score - 10);
        growPending += 2;          // 答錯懲罰：蛇身變長兩節
        sfx.wrongA();
        popFx(nx, ny, "答錯 −10", "#ffd0c8", "#96150c");
        spawnToken(pick(makeDistractors(question.answer, 3)));   // 補一顆干擾果實
        updateHud("score");
      }
    }

    drawSnake();
  }

  // ============================================================
  // 輸入
  // ============================================================
  function pushDir(name) {
    const nd = DIRS[name];
    if (!nd) return;
    const last = queuedDirs.length ? queuedDirs[queuedDirs.length - 1] : dir;
    if (nd.x === -last.x && nd.y === -last.y) return;
    if (nd.x === last.x && nd.y === last.y) return;
    if (queuedDirs.length < 2) queuedDirs.push(nd);
  }

  const KEYMAP = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    w: "up", s: "down", a: "left", d: "right",
    W: "up", S: "down", A: "left", D: "right",
  };

  document.addEventListener("keydown", e => {
    if (e.key === " ") {
      e.preventDefault();
      if (running) {
        paused = !paused;
        questionEl.innerHTML = paused
          ? "⏸ 已暫停 — 按空白鍵繼續"
          : `${question.html} = <b>?</b>`;
      }
      return;
    }
    const name = KEYMAP[e.key];
    if (name && running && !paused) {
      e.preventDefault();
      pushDir(name);
    }
  });

  document.querySelectorAll(".dpad-btn").forEach(btn => {
    btn.addEventListener("pointerdown", e => {
      e.preventDefault();
      if (running && !paused) pushDir(btn.dataset.dir);
    });
  });

  // ============================================================
  // 選單
  // ============================================================
  document.querySelectorAll(".diff-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      diffKey = btn.dataset.diff;
      document.querySelectorAll(".diff-btn").forEach(b => b.classList.toggle("selected", b === btn));
    });
  });

  document.getElementById("btnStart").onclick = startGame;
  document.getElementById("btnHow").onclick   = () => showPage(pageHow);
  document.getElementById("btnBack").onclick  = () => showPage(pageMenu);
  document.getElementById("btnRetry").onclick = startGame;
  document.getElementById("btnMenu").onclick  = () => {
    questionEl.textContent = "請在主選單選擇難度開始遊戲";
    showPage(pageMenu);
  };

  // 供自動化測試檢視狀態用的唯讀掛鉤
  window.__mathSnake = {
    get snake() { return snake.map(s => ({ ...s })); },
    get dir() { return { ...dir }; },
    get tokens() { return tokens.map(t => ({ x: t.x, y: t.y, value: t.value })); },
    get question() { return question ? { text: question.text, answer: question.answer } : null; },
    get boardItem() { return boardItem ? { x: boardItem.x, y: boardItem.y, type: boardItem.type } : null; },
    get effects() { return { ...effects }; },
    get score() { return score; },
    get correct() { return correct; },
    get wrong() { return wrong; },
    get running() { return running; },
    pushDir,
    debugSpawnItem(type) { nextItemAt = 0; if (boardItem) { boardItem.el.remove(); boardItem = null; } const c = freeCell(); if (c) { boardItem = { ...c, type, expireAt: now() + ITEM_LIFETIME }; boardItem.el = makeItemEl(boardItem); itemLayer.appendChild(boardItem.el); } },
  };

  // ============================================================
  // 啟動
  // ============================================================
  drawGround();
  drawNumberline();
  showPage(pageMenu);
})();
