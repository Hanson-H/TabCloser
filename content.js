// 浮动按钮关闭标签页 - 内容脚本
// 在页面顶部中央添加一个小尺寸浮动按钮（默认贴边隐藏，悬停弹出），
// 点击即可关闭当前标签页。可拖动到任意位置；拖到屏幕边缘可贴边隐藏，位置自动保存。

(function () {
  "use strict";

  // 仅在顶层窗口注入（避免 iframe 中重复出现按钮）
  if (window.top !== window.self) return;

  const HOST_ID = "dcct-float-close-host";
  const BTN_W = 45;            // 按钮宽度（px）
  const BTN_H = 45;            // 按钮高度（px）
  const DOCK_THRESHOLD = 36;   // 距左右边缘小于该值时贴边隐藏
  const HIDE_RATIO = 0.55;     // 贴边时隐藏的比例（左/右方向）
  const HIDE_RATIO_TOP = 0.7;  // 顶部贴边时隐藏的比例（隐藏更多，露出更少）
  const EDGE_GAP = 6;          // 贴边弹出后与浏览器边缘保留的距离（px）
  const HIT_EXT = 20;          // 贴边隐藏时隐形热区向屏幕内侧延伸的距离（px）
  const HIT_EXT_WIDE = 44;     // 右侧贴边时向左（屏幕内侧）的加大触发距离（px）

  let settings = { enabled: true, color: "#48484a" };
  let pos = null; // { x, y, docked: 'left' | 'right' | 'top' | null }；null 时使用默认位置

  let host = null;
  let btnEl = null; // Shadow DOM 内的按钮引用（closed shadow，供 applyPos 操作）

  // ---------- 设置加载与监听 ----------

  // 开关（sync）与位置（local）两份数据都就绪后才创建按钮：
  // 避免先按默认位置渲染、保存的位置迟到后再跳变——
  // 这正是新开页面按钮位置不一致、出现移动动画残留的根源
  let loaded = { settings: false, pos: false };

  chrome.storage.sync.get({ enabled: true, color: "#48484a" }, (items) => {
    settings = items;
    loaded.settings = true;
    initWhenReady();
  });

  chrome.storage.local.get({ pos: null }, (items) => {
    pos = items.pos;
    loaded.pos = true;
    initWhenReady();
  });

  function initWhenReady() {
    if (!loaded.settings || !loaded.pos) return;
    if (host) applyPos();
    else render();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.enabled) {
      settings.enabled = changes.enabled.newValue;
      render();
    }
    if (area === "sync" && changes.color) {
      settings.color = changes.color.newValue;
      if (host) applyColor();
    }
    if (area === "local" && changes.pos) {
      pos = changes.pos.newValue;
      if (host) applyPos();
    }
  });

  // ---------- 关闭标签页 ----------

  function closeTab() {
    chrome.runtime.sendMessage({ action: "closeTab" }, () => {
      // 扩展被更新/重载后 content script 会失效，静默处理错误
      if (chrome.runtime.lastError) return;
    });
  }

  // ---------- 按钮创建 / 移除 ----------

  function render() {
    if (settings.enabled) {
      if (!host) createButton();
    } else if (host) {
      host.remove();
      host = null;
      btnEl = null;
    }
  }

  function createButton() {
    host = document.createElement("div");
    host.id = HOST_ID;

    // 宿主元素样式：位置由 applyPos() 统一设置（默认：顶部中央贴边隐藏）
    host.style.cssText = [
      "position: fixed",
      "z-index: 2147483647",
      "width: " + BTN_W + "px",
      "height: " + BTN_H + "px",
      "cursor: pointer",
      "user-select: none"
    ].join(" !important;") + " !important;";

    // 使用 Shadow DOM 隔离页面 CSS 对按钮的影响
    // 注意：悬停效果只改背景/阴影/透明度（均为合成器或局部重绘），
    // 不使用 scale 变换，避免部分页面首次悬停时的整页重绘抖动
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        button {
          all: initial;
          box-sizing: border-box;
          position: relative; /* 作为隐形热区（::after）的定位基准 */
          width: ${BTN_W}px;
          height: ${BTN_H}px;
          border-radius: 10px;
          /* 按钮颜色由设置项动态注入（CSS 变量，默认深空石墨） */
          border: none;
          background: var(--btn-color, #48484a);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
          opacity: 0.85;
          -webkit-user-select: none;
          user-select: none;
          touch-action: none;
          will-change: transform;
          transition: transform 0.18s ease, background 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
        }
        button:hover {
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
          opacity: 0.85;
        }
        button:active {
          background: var(--btn-color-active, #3a3a3c);
        }
        /* 贴边隐藏：只露出一小半，悬停时滑出。
           圆角矩形轮廓：贴边时露出一条直边，形似浏览器标签页的边缘；
           弹出/缩回是整体平移，形状全程不变，不会出现"拖尾"变形。
           弹出用带回弹的 spring 曲线，缩回用更快的 ease-in 曲线，
           两个方向分开调校，进出都顺滑不拖泥带水 */
        :host([data-docked="right"]) button {
          transform: translateX(${HIDE_RATIO * 100}%);
          opacity: 0.4;
          transition: transform 0.26s cubic-bezier(0.55, 0, 0.3, 1),
                      opacity 0.2s ease, box-shadow 0.2s ease;
        }
        :host([data-docked="left"]) button {
          transform: translateX(-${HIDE_RATIO * 100}%);
          opacity: 0.4;
          transition: transform 0.26s cubic-bezier(0.55, 0, 0.3, 1),
                      opacity 0.2s ease, box-shadow 0.2s ease;
        }
        :host([data-docked="top"]) button {
          transform: translateY(-${HIDE_RATIO_TOP * 100}%);
          opacity: 0.4;
          transition: transform 0.26s cubic-bezier(0.55, 0, 0.3, 1),
                      opacity 0.2s ease, box-shadow 0.2s ease;
        }
        :host([data-docked="right"]) button:hover {
          transform: translateX(-${EDGE_GAP}px);
          opacity: 0.8;
          transition: transform 0.42s cubic-bezier(0.34, 1.45, 0.5, 1),
                      opacity 0.25s ease, box-shadow 0.3s ease;
        }
        :host([data-docked="left"]) button:hover {
          transform: translateX(${EDGE_GAP}px);
          opacity: 0.8;
          transition: transform 0.42s cubic-bezier(0.34, 1.45, 0.5, 1),
                      opacity 0.25s ease, box-shadow 0.3s ease;
        }
        :host([data-docked="top"]) button:hover {
          transform: translateY(${EDGE_GAP}px);
          opacity: 0.8;
          transition: transform 0.42s cubic-bezier(0.34, 1.45, 0.5, 1),
                      opacity 0.25s ease, box-shadow 0.3s ease;
        }
        /* 隐形热区：贴边隐藏时向屏幕内侧延伸 HIT_EXT px，
           悬停/点击更容易命中（伪元素跟随按钮的 transform 移动，
           弹出后仍环绕按钮，等效扩大点击目标）。
           仅贴边状态存在，自由摆放时不拦截页面点击 */
        :host([data-docked="top"]) button::after {
          content: "";
          position: absolute;
          left: -${HIT_EXT}px;
          right: -${HIT_EXT}px;
          top: 0;                 /* 朝上的一侧在屏幕外，无需延伸 */
          bottom: -${HIT_EXT}px;
        }
        :host([data-docked="left"]) button::after {
          content: "";
          position: absolute;
          left: 0;                /* 朝左的一侧在屏幕外 */
          right: -${HIT_EXT}px;
          top: -${HIT_EXT}px;
          bottom: -${HIT_EXT}px;
        }
        :host([data-docked="right"]) button::after {
          content: "";
          position: absolute;
          left: -${HIT_EXT_WIDE}px;   /* 右侧贴边：向左（屏幕内侧）加大触发范围 */
          right: 0;               /* 朝右的一侧在屏幕外 */
          top: -${HIT_EXT}px;
          bottom: -${HIT_EXT}px;
        }
        /* 拖动时关闭过渡，保证按钮跟手不漂移 */
        button.no-anim {
          transition: none !important;
        }
        /* 图标：Bootstrap Icons trash3-fill（MIT 协议），实心垃圾桶，
           表示"关闭/丢弃当前标签页"。fill 图标跟随 currentColor，
           按钮整体的 hover 反馈（背景/阴影/透明度）已足够，无需额外变换 */
        button svg {
          display: block;
        }
      </style>
      <button title="关闭标签页" aria-label="关闭当前标签页">
        <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M11 1.5v1h3.5a.5.5 0 0 1 0 1h-.538l-.853 10.66A2 2 0 0 1 11.115 16h-6.23a2 2 0 0 1-1.994-1.84L2.038 3.5H1.5a.5.5 0 0 1 0-1H5v-1A1.5 1.5 0 0 1 6.5 0h3A1.5 1.5 0 0 1 11 1.5Zm-5 0v1h4v-1a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5ZM4.5 5.029l.5 8.5a.5.5 0 1 0 .998-.06l-.5-8.5a.5.5 0 1 0-.998.06Zm6.53-.528a.5.5 0 0 0-.528.47l-.5 8.5a.5.5 0 0 0 .998.058l.5-8.5a.5.5 0 0 0-.47-.528ZM8 4.5a.5.5 0 0 0-.5.5v8.5a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5Z"/>
        </svg>
      </button>
    `;

    const btn = shadow.querySelector("button");
    btnEl = btn;
    bindDragAndClick(btn);

    applyColor();
    applyPos();
    document.documentElement.appendChild(host);
  }

  // 应用按钮颜色（主色 + 按下态的加深色），通过 CSS 变量注入 Shadow DOM。
  // 按下态用 color-mix 把主色压暗，颜色切换后无需重建按钮即可即时生效
  function applyColor() {
    if (!host) return;
    host.style.setProperty("--btn-color", settings.color);
    host.style.setProperty(
      "--btn-color-active",
      "color-mix(in srgb, " + settings.color + " 82%, #000)"
    );
  }

  // ---------- 位置管理 ----------

  // 可视区宽度（排除经典滚动条占用的宽度；window.innerWidth 包含滚动条，
  // 用它定位右侧会把按钮压在滚动条下面导致看不见）。
  // 注意：仅用于"右侧贴边"与"防超出可视区"这两处必须保证可见的计算；
  // 默认居中等位置基准统一用 window.innerWidth，保证有无滚动条的页面
  // 按钮显示位置完全一致
  function viewW() {
    return document.documentElement.clientWidth || window.innerWidth;
  }

  // 可视区高度（排除底部横向滚动条，与 viewW 同理）
  function viewH() {
    return document.documentElement.clientHeight || window.innerHeight;
  }

  function clampY(y) {
    return Math.min(Math.max(y, 0), Math.max(viewH() - BTN_H, 0));
  }

  function clampX(x) {
    return Math.min(Math.max(x, 0), Math.max(viewW() - BTN_W, 0));
  }

  // 默认位置：页面顶部中央，贴边隐藏。
  // 居中基准用 window.innerWidth（窗口绝对宽度）：有无滚动条的页面
  // 计算结果一致，按钮不会因滚动条出现而左右偏移
  function defaultPos() {
    return {
      x: Math.max((window.innerWidth - BTN_W) / 2, 0),
      y: 0,
      docked: "top"
    };
  }

  // 应用位置（未拖动过则使用默认：顶部中央贴边隐藏）。
  // animate 未传（程序化定位：初始化、存储变更、窗口/滚动条尺寸校正）
  // 时禁用过渡动画，按钮直接落到目标位置，不产生滑动残影；
  // 仅拖拽松手贴边时传 true，保留滑入边缘的动画
  function applyPos(animate) {
    if (!host) return;
    const suppress = !animate && btnEl;
    if (suppress) btnEl.classList.add("no-anim");

    const p = pos || defaultPos();

    host.style.setProperty("right", "auto", "important");
    host.style.setProperty("top", "auto", "important");

    const x = p.docked === "left" ? 0
      : p.docked === "right" ? viewW() - BTN_W
      : clampX(p.x);
    const y = p.docked === "top" ? 0 : clampY(p.y);

    host.style.setProperty("left", x + "px", "important");
    host.style.setProperty("top", y + "px", "important");

    if (p.docked) {
      host.setAttribute("data-docked", p.docked);
    } else {
      host.removeAttribute("data-docked");
    }

    if (suppress) {
      // 强制回流，把"无过渡"状态下的样式变更提交掉，
      // 下一帧再恢复过渡——此后悬停弹出/缩回动画照常生效
      void btnEl.offsetHeight;
      requestAnimationFrame(() => {
        if (btnEl) btnEl.classList.remove("no-anim");
      });
    }
  }

  function savePos() {
    chrome.storage.local.set({ pos: pos });
  }

  // ---------- 拖动 + 点击 ----------

  function bindDragAndClick(btn) {
    const DRAG_THRESHOLD = 4; // 位移超过该值视为拖动而非点击
    let startX = 0, startY = 0;   // pointerdown 时指针坐标
    let originX = 0, originY = 0; // pointerdown 时按钮逻辑坐标
    let dragged = false;
    let dockedAtDown = null;      // 按下时按钮是否处于贴边状态（及方向）
    let hoverOffsetX = 0, hoverOffsetY = 0; // 按下时的悬停弹出偏移

    btn.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      // 拖动期间关闭过渡动画，保证按钮跟手不漂移
      btn.classList.add("no-anim");

      dragged = false;
      startX = e.clientX;
      startY = e.clientY;

      const rect = host.getBoundingClientRect();
      originX = rect.left;
      originY = rect.top;

      // 记录按下时的贴边方向与悬停弹出偏移（host 的 rect 不受内部按钮
      // transform 影响，即"逻辑位置"）。注意：解除贴边延迟到真正开始
      // 拖动时才执行——纯点击（关闭标签页）时按钮原地不动，不会跳动
      dockedAtDown = host.getAttribute("data-docked");
      hoverOffsetX = 0;
      hoverOffsetY = 0;
      if (dockedAtDown && btn.matches(":hover")) {
        if (dockedAtDown === "right") hoverOffsetX = -EDGE_GAP;
        else if (dockedAtDown === "left") hoverOffsetX = EDGE_GAP;
        else if (dockedAtDown === "top") hoverOffsetY = EDGE_GAP;
      }

      btn.addEventListener("pointermove", onMove);
      btn.addEventListener("pointerup", onUp);
      btn.addEventListener("pointercancel", onUp);
    });

    function onMove(e) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

      if (!dragged) {
        // 首次越过拖动阈值：此时才解除贴边，
        // 并把按钮放到按下时的可见位置（含弹出偏移），保证跟手
        dragged = true;
        if (dockedAtDown) {
          host.removeAttribute("data-docked");
          originX += hoverOffsetX;
          originY += hoverOffsetY;
          host.style.setProperty("left", originX + "px", "important");
          host.style.setProperty("top", originY + "px", "important");
        }
      }

      host.style.setProperty("left", clampX(originX + dx) + "px", "important");
      host.style.setProperty("top", clampY(originY + dy) + "px", "important");
    }

    function onUp(e) {
      btn.removeEventListener("pointermove", onMove);
      btn.removeEventListener("pointerup", onUp);
      btn.removeEventListener("pointercancel", onUp);
      btn.classList.remove("no-anim");

      if (dragged) {
        // 拖动结束：判断是否贴边（上 / 左 / 右），并保存位置
        const rect = host.getBoundingClientRect();
        let x = rect.left;
        let y = rect.top;
        let docked = null;

        if (y <= DOCK_THRESHOLD) {
          docked = "top";
          y = 0;
        } else if (x <= DOCK_THRESHOLD) {
          docked = "left";
          x = 0;
        } else if (x + BTN_W >= viewW() - DOCK_THRESHOLD) {
          docked = "right";
          x = viewW() - BTN_W;
        }

        pos = { x: x, y: clampY(y), docked: docked };
        savePos();
        applyPos(true); // 拖拽松手贴边：保留滑入边缘的动画
      } else {
        // 纯点击：关闭当前标签页
        closeTab();
      }
    }
  }

  // 窗口尺寸变化时把按钮拉回可视区（贴边时吸附到对应边缘；未自定义过则重新居中）
  window.addEventListener("resize", () => {
    if (!host) return;
    if (pos) {
      const rect = host.getBoundingClientRect();
      pos = {
        x: clampX(rect.left),
        y: clampY(rect.top),
        docked: pos.docked
      };
    }
    applyPos();
  });

  // 页面内容动态增减导致滚动条出现/消失时，documentElement 尺寸会变化，
  // 此时重新校正位置，避免右侧贴边按钮被滚动条遮住
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      if (host) applyPos();
    });
    ro.observe(document.documentElement);
  }

  // ---------- 页面切回前台时恢复弹出动画 ----------
  // 场景：连续关闭多个标签页 / 切换标签页时，鼠标正停在按钮位置上。
  // 弹出动画依赖 :hover 的 transform 过渡，需要"上一帧隐藏态 → 当前帧
  // 弹出态"才能播放。而后台标签页存在两个问题：
  //   1) applyPos() 加的 no-anim 类靠 rAF 移除，但 rAF 在后台不执行，
  //      该类会一直滞留（过渡被禁用）；
  //   2) 页面变为可见的瞬间 :hover 与首帧同时生效，没有可过渡的上一帧。
  // 两者叠加导致按钮"瞬间出现在弹出位置"，动画被跳过。
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !btnEl || !host) return;
    // 1) 清掉可能滞留的 no-anim（后台期间 rAF 被暂停导致未按时移除）
    btnEl.classList.remove("no-anim");
    const docked = host.getAttribute("data-docked");
    if (!docked) return;
    // 2) 若鼠标此刻正悬停在按钮上，强制重播弹出动画：
    //    先无动画地复位到贴边隐藏态，再移除内联样式，
    //    让 :hover 的过渡从隐藏态重新播放一遍
    requestAnimationFrame(() => {
      if (!btnEl || !btnEl.matches(":hover")) return;
      const hiddenTf =
        docked === "right" ? "translateX(" + (HIDE_RATIO * 100) + "%)" :
        docked === "left" ? "translateX(-" + (HIDE_RATIO * 100) + "%)" :
                            "translateY(-" + (HIDE_RATIO_TOP * 100) + "%)";
      btnEl.style.setProperty("transition", "none", "important");
      btnEl.style.transform = hiddenTf;
      void btnEl.offsetHeight; // 强制回流，提交复位样式
      btnEl.style.removeProperty("transition");
      btnEl.style.transform = ""; // 移除后 :hover 弹出态生效，过渡重新播放
    });
  });
})();
