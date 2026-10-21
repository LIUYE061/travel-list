(function () {
  "use strict";

  var hero = document.querySelector(".hero-in");
  if (!hero || document.getElementById("install-open")) return;

  var isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  var ua = navigator.userAgent || "";
  var isIOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/i.test(ua);
  var isEmbedded = /MicroMessenger|QQ\//i.test(ua);
  var deferredPrompt = null;

  var brand = document.createElement("div");
  brand.className = "hero-brand";
  while (hero.firstChild) brand.appendChild(hero.firstChild);

  var openButton = document.createElement("button");
  openButton.className = "install-btn";
  openButton.id = "install-open";
  openButton.type = "button";
  openButton.setAttribute("aria-label", "安装到手机主屏幕");
  openButton.innerHTML = '<span class="plus" aria-hidden="true">＋</span><span class="label">安装</span>';

  hero.appendChild(brand);
  hero.appendChild(openButton);

  document.body.insertAdjacentHTML("beforeend", [
    '<div class="install-modal" id="install-modal" role="dialog" aria-modal="true" aria-labelledby="install-title" hidden>',
    '  <div class="install-card">',
    '    <div class="install-head">',
    "      <div>",
    '        <h2 id="install-title">把清单放到手机桌面</h2>',
    '        <p id="install-lead">安装后可从桌面直接打开，使用体验接近原生 App。</p>',
    "      </div>",
    '      <button class="install-close" id="install-close" type="button" aria-label="关闭安装说明">×</button>',
    "    </div>",
    '    <ol class="install-steps" id="install-steps"></ol>',
    '    <div class="install-note" id="install-note">主屏入口打开的是当前网址对应的同一份程序，原有链接仍然可以继续访问。</div>',
    '    <button class="btn primary install-action" id="install-action" type="button" hidden>安装到手机</button>',
    "  </div>",
    "</div>"
  ].join(""));

  function $(id) { return document.getElementById(id); }
  function step(number, text) {
    var li = document.createElement("li");
    li.className = "install-step";
    var n = document.createElement("span");
    n.className = "n";
    n.textContent = number;
    var label = document.createElement("span");
    label.textContent = text;
    li.appendChild(n);
    li.appendChild(label);
    return li;
  }
  function clear(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  function renderInstallGuide() {
    var list = $("install-steps"), note = $("install-note"), action = $("install-action");
    var lead = $("install-lead");
    clear(list);
    note.className = "install-note";
    action.hidden = true;

    if (location.protocol === "file:") {
      lead.textContent = "当前是本地文件，手机主屏安装需要通过在线网址打开。";
      list.appendChild(step(1, "先用手机浏览器打开 GitHub Pages 上的在线网址。"));
      list.appendChild(step(2, "再按页面中的安装提示添加到主屏幕。"));
      note.className = "install-note warn";
      note.textContent = "在线网址：https://LIUYE061.github.io/travel-list/";
      return;
    }

    if (isEmbedded) {
      lead.textContent = "当前浏览器不能直接创建主屏图标，请改用系统浏览器打开。";
      list.appendChild(step(1, "点右上角菜单，选择“在浏览器中打开”。"));
      list.appendChild(step(2, "在 Safari 或 Chrome 中再次打开本页。"));
      list.appendChild(step(3, "按下面的系统步骤添加到主屏幕。"));
      note.className = "install-note warn";
      note.textContent = "微信、QQ 等内置浏览器通常不支持主屏 Web Clip。";
      return;
    }

    if (deferredPrompt) {
      lead.textContent = "当前浏览器支持一键安装，主屏入口会以独立窗口打开。";
      list.appendChild(step(1, "点下方“安装到手机”。"));
      list.appendChild(step(2, "确认安装，等待桌面出现“出行清单”图标。"));
      action.hidden = false;
      return;
    }

    if (isIOS) {
      lead.textContent = "在 iPhone 或 iPad 的 Safari 中，几步就能创建桌面图标。";
      list.appendChild(step(1, "点 Safari 底部的“分享”按钮。"));
      list.appendChild(step(2, "在菜单中找到并点“添加到主屏幕”。"));
      list.appendChild(step(3, "点右上角“添加”，之后从桌面启动。"));
      return;
    }

    if (isAndroid) {
      lead.textContent = "在 Chrome 中可以把网页安装成独立运行的应用。";
      list.appendChild(step(1, "点浏览器右上角的“三点”菜单。"));
      list.appendChild(step(2, "选择“安装应用”或“添加到主屏幕”。"));
      list.appendChild(step(3, "确认后，从手机桌面打开出行清单。"));
      return;
    }

    lead.textContent = "当前浏览器可以通过菜单创建网页快捷方式。";
    list.appendChild(step(1, "打开浏览器菜单。"));
    list.appendChild(step(2, "选择“安装应用”或“添加到主屏幕”。"));
    list.appendChild(step(3, "确认后，从桌面打开出行清单。"));
  }

  function openInstallGuide() {
    renderInstallGuide();
    $("install-modal").hidden = false;
    document.body.style.overflow = "hidden";
    $("install-close").focus();
  }

  function closeInstallGuide() {
    $("install-modal").hidden = true;
    document.body.style.overflow = "";
    if (!isStandalone) openButton.focus();
  }

  if (isStandalone) document.body.classList.add("standalone");

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    deferredPrompt = event;
    if (!$("install-modal").hidden) renderInstallGuide();
  });

  window.addEventListener("appinstalled", function () {
    deferredPrompt = null;
    closeInstallGuide();
  });

  openButton.addEventListener("click", openInstallGuide);
  $("install-close").addEventListener("click", closeInstallGuide);
  $("install-modal").addEventListener("click", function (event) {
    if (event.target === this) closeInstallGuide();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !$("install-modal").hidden) closeInstallGuide();
  });
  $("install-action").addEventListener("click", function () {
    if (!deferredPrompt) return;
    var prompt = deferredPrompt;
    deferredPrompt = null;
    prompt.prompt();
    prompt.userChoice.then(function (choice) {
      if (choice.outcome === "accepted") closeInstallGuide();
    });
  });

  if (!isStandalone && new URLSearchParams(location.search).get("install") === "1") {
    openInstallGuide();
  }

  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js", { scope: "./" });
    });
  }
})();
