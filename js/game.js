/* ============================================================
 * 有向數貪食蛇 Math Snake
 * 以貪食蛇玩法練習有向數（正負數）加法：
 * 吃下正負數果實，使「目前總和」剛好等於「目標總和」即可過關。
 * ============================================================ */

(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  // ---------- 棋盤參數 ----------
  const COLS = 21;
  const ROWS = 15;
  const CELL = 36;                    // 與 index.html 的 viewBox 756x540 對應
  const TOKEN_COUNT = 6;              // 場上同時存在的果實數
  const NL_RANGE = 15;                // 數軸顯示 -15 ~ +15

  // ---------- DOM ----------
  const board       = document.getElementById("board");
  const groundLayer = document.getElementById("groundLayer");
  const tokenLayer  = document.getElementById("tokenLayer");
  const snakeLayer  = document.getElementById("snakeLayer");
  const fxLayer     = document.getElementById("fxLayer");
  const numberline  = document.getElementById("numberline");

  const hudLevel  = document.getElementById("hudLevel");
  const hudScore  = document.getElementById("hudScore");
  const hudTarget = document.getElementById("hudTarget");
  const hudSum    = document.getElementById("hudSum");
  const hudNeed   = document.getElementById("hudNeed");
  const equation  = document.getElementById("equation");

  const overlay      = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayBody  = document.getElementById("overlayBody");
  const overlayBtn   = document.getElementById("overlayBtn");

  // ---------- 遊戲狀態 ----------
  const DIRS = {
    up:    { x: 0,  y: -1 },
    down:  { x: 0,  y: 1 },
    left:  { x: -1, y: 0 },
    right: { x: 1,  y: 0 },
  };

  let snake = [];          // [{x,y}]，index 0 為蛇頭
  let dir = DIRS.right;
  let queuedDirs = [];     // 方向輸入佇列，避免一格內連按造成自撞
  let tokens = [];         // [{x,y,value,el}]
  let sum = 0;
  let target = 0;
  let level = 1;
  let score = 0;
  let terms = [];          // 本關吃到的數，組出算式
  let tickMs = 190;
  let timer = null;
  let running = false;
  let paused = false;

  // ---------- 工具 ----------
  const randInt = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;

  function el(name, attrs = {}, parent = null) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  function fmt(n) { return n > 0 ? `+${n}` : `${n}`; }

  function signClass(n) { return n > 0 ? "pos" : n < 0 ? "neg" : "zero"; }

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
    eatPos:  () => { beep(660, 0.1, "triangle"); beep(880, 0.12, "triangle"); },
    eatNeg:  () => { beep(330, 0.12, "sawtooth", 0.08); beep(262, 0.14, "sawtooth", 0.08); },
    win:     () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.16, "triangle"), i * 110)); },
    crash:   () => { beep(150, 0.3, "sawtooth", 0.2); },
  };

  // ============================================================
  // 草地（棋格明暗交錯，營造修剪過的草坪質感）
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
    // 邊緣暗角，增加立體感
    el("rect", {
      x: 0, y: 0, width: COLS * CELL, height: ROWS * CELL,
      fill: "none", stroke: "rgba(20,50,5,0.35)", "stroke-width": 10,
    }, groundLayer);
  }

  // ============================================================
  // 果實：正數 → 蘋果、負數 → 藍莓
  // ============================================================
  function makeTokenEl(token) {
    const cx = token.x * CELL + CELL / 2;
    const cy = token.y * CELL + CELL / 2;
    const g = el("g", { filter: "url(#tinyShadow)" });
    const inner = el("g", { class: "token-bob" }, g);
    inner.style.transformOrigin = `${cx}px ${cy}px`;

    const r = CELL * 0.42;

    if (token.value > 0) {
      // 蘋果本體（略呈心形的兩個圓）
      el("circle", { cx: cx - r * 0.28, cy, r: r * 0.82, fill: "url(#appleGrad)" }, inner);
      el("circle", { cx: cx + r * 0.28, cy, r: r * 0.82, fill: "url(#appleGrad)" }, inner);
      // 果梗與葉子
      el("path", {
        d: `M ${cx} ${cy - r * 0.7} q -2 -7 2 -11`,
        stroke: "#6b4a1d", "stroke-width": 3, fill: "none", "stroke-linecap": "round",
      }, inner);
      el("path", {
        d: `M ${cx + 2} ${cy - r * 1.02} q 10 -6 14 2 q -9 6 -14 -2 Z`,
        fill: "#4e9427",
      }, inner);
      // 高光
      el("ellipse", {
        cx: cx - r * 0.42, cy: cy - r * 0.38, rx: r * 0.26, ry: r * 0.16,
        fill: "rgba(255,255,255,0.65)", transform: `rotate(-28 ${cx - r * 0.42} ${cy - r * 0.38})`,
      }, inner);
    } else {
      // 藍莓本體
      el("circle", { cx, cy, r, fill: "url(#berryGrad)" }, inner);
      // 頂端果萼
      const star = [];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 === 0 ? 4.5 : 2;
        star.push(`${cx + Math.cos(a) * rr},${cy - r * 0.62 + Math.sin(a) * rr}`);
      }
      el("polygon", { points: star.join(" "), fill: "#22307f", opacity: 0.9 }, inner);
      // 高光
      el("ellipse", {
        cx: cx - r * 0.36, cy: cy - r * 0.36, rx: r * 0.24, ry: r * 0.15,
        fill: "rgba(255,255,255,0.55)", transform: `rotate(-30 ${cx - r * 0.36} ${cy - r * 0.36})`,
      }, inner);
    }

    // 數值標籤
    el("text", {
      x: cx, y: cy + 5.5,
      "text-anchor": "middle",
      "font-size": 15,
      "font-weight": 800,
      "font-family": "inherit",
      fill: "#fff",
      stroke: "rgba(0,0,0,0.35)",
      "stroke-width": 2.6,
      "paint-order": "stroke",
    }, inner).textContent = fmt(token.value);

    return g;
  }

  function occupied(x, y) {
    return snake.some(s => s.x === x && s.y === y) ||
           tokens.some(t => t.x === x && t.y === y);
  }

  function randomTokenValue() {
    const need = target - sum;
    // 有一定機率直接生成「剛好補齊差值」的果實，確保關卡可解
    if (need !== 0 && Math.abs(need) <= 9 && Math.random() < 0.45 &&
        !tokens.some(t => t.value === need)) {
      return need;
    }
    let v = 0;
    while (v === 0) v = randInt(-9, 9);
    return v;
  }

  function spawnToken() {
    let x, y, tries = 0;
    do {
      x = randInt(1, COLS - 2);
      y = randInt(1, ROWS - 2);
      tries++;
    } while (occupied(x, y) && tries < 300);
    if (tries >= 300) return;
    const token = { x, y, value: randomTokenValue() };
    token.el = makeTokenEl(token);
    tokenLayer.appendChild(token.el);
    tokens.push(token);
  }

  function refillTokens() {
    while (tokens.length < TOKEN_COUNT) spawnToken();
    // 保底：場上至少一顆能讓學生「朝目標靠近」的果實
    const need = target - sum;
    if (need !== 0 && Math.abs(need) <= 9 && !tokens.some(t => t.value === need) && tokens.length > 0) {
      const t = tokens[0];
      t.value = need;
      const fresh = makeTokenEl(t);
      tokenLayer.replaceChild(fresh, t.el);
      t.el = fresh;
    }
  }

  // ============================================================
  // 蛇（重疊漸層圓 + 菱形斑紋 + 立體蛇頭）
  // ============================================================
  function drawSnake() {
    snakeLayer.innerHTML = "";
    const n = snake.length;
    const body = el("g", { filter: "url(#softShadow)" }, snakeLayer);

    // 由尾到頭繪製，讓頭疊在最上層；半徑往尾端漸縮
    for (let i = n - 1; i >= 1; i--) {
      const seg = snake[i];
      const t = i / Math.max(n - 1, 1);           // 0=頭側, 1=尾端
      const r = CELL * (0.46 - 0.18 * t);
      const cx = seg.x * CELL + CELL / 2;
      const cy = seg.y * CELL + CELL / 2;
      el("circle", { cx, cy, r, fill: "url(#bodyGrad)" }, body);
      // 每隔一節加上蟒蛇式菱形斑紋
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

    // 吐信（先畫，讓頭蓋在上面）
    const tongue = el("g", { class: "tongue" }, g);
    el("path", {
      d: `M ${R * 0.9} 0 L ${R * 1.5} 0 M ${R * 1.5} 0 L ${R * 1.85} -4 M ${R * 1.5} 0 L ${R * 1.85} 4`,
      stroke: "#d6274b", "stroke-width": 2.6, fill: "none", "stroke-linecap": "round",
    }, tongue);

    // 頭部（朝行進方向的橢圓）
    el("ellipse", { cx: 0, cy: 0, rx: R * 1.12, ry: R * 0.92, fill: "url(#headGrad)" }, g);
    // 頭頂高光
    el("ellipse", {
      cx: -R * 0.2, cy: -R * 0.34, rx: R * 0.5, ry: R * 0.22,
      fill: "rgba(255,255,255,0.28)",
    }, g);

    // 鼻孔
    el("circle", { cx: R * 0.78, cy: -R * 0.18, r: 1.7, fill: "#1e3d10" }, g);
    el("circle", { cx: R * 0.78, cy:  R * 0.18, r: 1.7, fill: "#1e3d10" }, g);

    // 眼睛（眼白 + 縱向瞳孔 + 高光）
    for (const side of [-1, 1]) {
      el("ellipse", { cx: R * 0.3, cy: side * R * 0.46, rx: R * 0.3, ry: R * 0.28, fill: "#f7f4e0" }, g);
      el("ellipse", { cx: R * 0.36, cy: side * R * 0.46, rx: R * 0.1, ry: R * 0.2, fill: "#1c2a0d" }, g);
      el("circle",  { cx: R * 0.32, cy: side * R * 0.46 - 2.5, r: 1.6, fill: "#fff" }, g);
    }
  }

  // ============================================================
  // 數軸（-15 ~ +15，紅旗 = 目標，蛇頭標記 = 目前總和）
  // ============================================================
  const NL = { w: 756, h: 84, pad: 26, y: 50 };
  const nlX = v => NL.pad + ((v + NL_RANGE) / (2 * NL_RANGE)) * (NL.w - NL.pad * 2);

  function drawNumberline() {
    numberline.innerHTML = "";

    // 主軸與箭頭
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

    // 目標紅旗（遊戲開始前 target 為 0，不顯示）
    if (target !== 0) drawTargetFlag();

    // 目前總和標記（小蛇頭），用 transform 移動以套用 CSS 過渡動畫
    const marker = el("g", { id: "nlMarker" }, numberline);
    el("ellipse", { cx: 0, cy: 0, rx: 11, ry: 9, fill: "url(#headGrad)", filter: "url(#tinyShadow)" }, marker);
    el("circle", { cx: 3.5, cy: -3, r: 2.6, fill: "#f7f4e0" }, marker);
    el("circle", { cx: 4.2, cy: -3, r: 1.2, fill: "#1c2a0d" }, marker);
    el("circle", { cx: 3.5, cy: 3, r: 2.6, fill: "#f7f4e0" }, marker);
    el("circle", { cx: 4.2, cy: 3, r: 1.2, fill: "#1c2a0d" }, marker);
    el("path", { d: "M 0 14 l -5 6 h 10 Z", fill: "#5c4a24" }, marker);
    updateNlMarker();
  }

  function drawTargetFlag() {
    const tx = nlX(clampNL(target));
    const flag = el("g", {}, numberline);
    el("line", { x1: tx, y1: NL.y - 6, x2: tx, y2: NL.y - 34, stroke: "#7a4a1d", "stroke-width": 2.6, "stroke-linecap": "round" }, flag);
    el("path", { d: `M ${tx} ${NL.y - 34} l 20 6 l -20 6 Z`, fill: "#d6362a", stroke: "#96150c", "stroke-width": 1 }, flag);
    el("text", {
      x: tx, y: NL.y - 38, "text-anchor": "middle", "font-size": 12, "font-weight": 800, fill: "#96150c",
    }, flag).textContent = `目標 ${fmt(target)}`;
  }

  function clampNL(v) { return Math.max(-NL_RANGE, Math.min(NL_RANGE, v)); }

  function updateNlMarker() {
    const marker = document.getElementById("nlMarker");
    if (marker) marker.style.transform = `translate(${nlX(clampNL(sum))}px, ${NL.y - 22}px)`;
  }

  // ============================================================
  // HUD / 算式
  // ============================================================
  function updateHud(bumpSum = false) {
    hudLevel.textContent = level;
    hudScore.textContent = score;
    hudTarget.textContent = fmt(target);

    hudSum.textContent = fmt(sum).replace("+0", "0");
    hudSum.className = `hud-value ${signClass(sum)}`;

    const need = target - sum;
    hudNeed.textContent = fmt(need).replace("+0", "0");
    hudNeed.className = `hud-value ${signClass(need)}`;

    if (bumpSum) {
      hudSum.classList.add("bump");
      setTimeout(() => hudSum.classList.remove("bump"), 380);
    }
    updateNlMarker();
  }

  function updateEquation() {
    if (terms.length === 0) {
      equation.innerHTML = `目標 <b>${fmt(target)}</b>：吃下果實，讓總和剛好等於目標！`;
      return;
    }
    const parts = terms.map(v => {
      const cls = v > 0 ? "pos" : "neg";
      return `<span class="${cls}">(${fmt(v)})</span>`;
    });
    equation.innerHTML = `0 ${parts.map(p => `+ ${p}`).join(" ")} = <b>${fmt(sum).replace("+0", "0")}</b>`;
  }

  // ============================================================
  // 吃果實特效
  // ============================================================
  function popFx(x, y, value) {
    const cx = x * CELL + CELL / 2;
    const cy = y * CELL + CELL / 2;
    const t = el("text", {
      x: cx, y: cy - 6,
      class: "fx-pop",
      "text-anchor": "middle",
      "font-size": 22,
      fill: value > 0 ? "#ffd8cf" : "#cdd8ff",
      stroke: value > 0 ? "#96150c" : "#1d2a80",
      "stroke-width": 3.2,
      "paint-order": "stroke",
    }, fxLayer);
    t.textContent = value > 0 ? `加 ${value}` : `減 ${-value}`;
    t.style.transformOrigin = `${cx}px ${cy}px`;
    setTimeout(() => t.remove(), 950);
  }

  // ============================================================
  // 關卡流程
  // ============================================================
  function newTarget() {
    const span = Math.min(6 + level * 2, NL_RANGE - 3);
    let t = 0;
    while (t === 0) t = randInt(-span, span);
    return t;
  }

  function startLevel(resetSnake) {
    sum = 0;
    terms = [];
    target = newTarget();

    if (resetSnake) {
      const cy = Math.floor(ROWS / 2);
      snake = [{ x: 5, y: cy }, { x: 4, y: cy }, { x: 3, y: cy }];
      dir = DIRS.right;
      queuedDirs = [];
    }

    tokens.forEach(t => t.el.remove());
    tokens = [];
    refillTokens();

    tickMs = Math.max(100, 190 - (level - 1) * 12);
    drawNumberline();
    drawSnake();
    updateHud();
    updateEquation();
  }

  function levelClear() {
    running = false;
    clearInterval(timer);
    sfx.win();
    score += 100 + level * 20;

    const eq = terms.map(v => `(${fmt(v)})`).join(" + ");
    showOverlay(
      "🎉 過關成功！",
      `<p>你完成了算式：</p>
       <p class="big-num">0 + ${eq} = <b class="${signClass(sum)}">${fmt(sum).replace("+0", "0")}</b></p>
       <p>剛好等於目標 <b>${fmt(target)}</b>，太棒了！</p>
       <p class="hint">獲得 ${100 + level * 20} 分</p>`,
      "下一關",
      () => { level++; startLevel(false); startLoop(); }
    );
    updateHud();
  }

  function gameOver(reason) {
    running = false;
    clearInterval(timer);
    sfx.crash();
    showOverlay(
      "💥 遊戲結束",
      `<p>${reason}</p>
       <p>最終分數：<b class="big-num">${score}</b>（到達第 ${level} 關）</p>
       <p class="hint">小提醒：吃到負數會「往回減」，規劃路線時想想數軸的方向喔！</p>`,
      "再玩一次",
      () => { level = 1; score = 0; startLevel(true); startLoop(); }
    );
  }

  function showOverlay(title, bodyHtml, btnText, onClick) {
    overlayTitle.textContent = title;
    overlayBody.innerHTML = bodyHtml;
    overlayBtn.textContent = btnText;
    overlayBtn.onclick = () => {
      overlay.classList.add("hidden");
      onClick();
    };
    overlay.classList.remove("hidden");
  }

  // ============================================================
  // 主迴圈
  // ============================================================
  function tick() {
    if (paused) return;

    if (queuedDirs.length) dir = queuedDirs.shift();

    const head = snake[0];
    const nx = head.x + dir.x;
    const ny = head.y + dir.y;

    // 撞牆
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
      gameOver("小蛇撞到圍欄了！");
      return;
    }
    // 撞到自己（尾巴這回合會前進，故排除最後一節）
    if (snake.some((s, i) => i < snake.length - 1 && s.x === nx && s.y === ny)) {
      gameOver("小蛇咬到自己的身體了！");
      return;
    }

    snake.unshift({ x: nx, y: ny });

    const hit = tokens.findIndex(t => t.x === nx && t.y === ny);
    if (hit >= 0) {
      const token = tokens[hit];
      token.el.remove();
      tokens.splice(hit, 1);

      sum += token.value;
      terms.push(token.value);
      score += 10;
      (token.value > 0 ? sfx.eatPos : sfx.eatNeg)();
      popFx(nx, ny, token.value);

      // 吃到果實蛇身變長（不移除尾巴）
      refillTokens();
      updateHud(true);
      updateEquation();

      if (sum === target) {
        drawSnake();
        levelClear();
        return;
      }
    } else {
      snake.pop();
    }

    drawSnake();
  }

  function startLoop() {
    running = true;
    paused = false;
    clearInterval(timer);
    timer = setInterval(tick, tickMs);
  }

  // ============================================================
  // 輸入
  // ============================================================
  function pushDir(name) {
    const nd = DIRS[name];
    if (!nd) return;
    const last = queuedDirs.length ? queuedDirs[queuedDirs.length - 1] : dir;
    // 不允許 180 度回頭
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
        equation.innerHTML = paused
          ? "⏸ 已暫停 — 按空白鍵繼續"
          : (updateEquation(), equation.innerHTML);
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
    const handler = e => {
      e.preventDefault();
      if (running && !paused) pushDir(btn.dataset.dir);
    };
    btn.addEventListener("pointerdown", handler);
  });

  // 供自動化測試檢視狀態用的唯讀掛鉤
  window.__mathSnake = {
    get snake() { return snake.map(s => ({ ...s })); },
    get tokens() { return tokens.map(t => ({ x: t.x, y: t.y, value: t.value })); },
    get sum() { return sum; },
    get target() { return target; },
    get level() { return level; },
    get running() { return running; },
    pushDir,
  };

  // ============================================================
  // 啟動
  // ============================================================
  drawGround();
  drawNumberline();

  overlayBtn.onclick = () => {
    overlay.classList.add("hidden");
    startLevel(true);
    startLoop();
  };
})();
