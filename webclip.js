(function () {
  "use strict";

  // Install guidance is shared by every browser, with native prompts when exposed.
  var hero = document.querySelector(".hero-in");
  if (!hero || document.getElementById("install-open")) return;

  var standaloneQueries = [
    "(display-mode: standalone)",
    "(display-mode: fullscreen)",
    "(display-mode: minimal-ui)"
  ];
  var isStandalone = standaloneQueries.some(function (query) {
    return window.matchMedia && window.matchMedia(query).matches;
  }) || window.navigator.standalone === true;
  var browser = detectBrowser();
  var deferredPrompt = null;
  var actionTimer = null;

  var brand = document.createElement("div");
  brand.className = "hero-brand";
  while (hero.firstChild) brand.appendChild(hero.firstChild);

  var openButton = document.createElement("button");
  openButton.className = "install-btn";
  openButton.id = "install-open";
  openButton.type = "button";
  openButton.setAttribute("aria-label", "安装到主屏幕或桌面");
  openButton.innerHTML = '<span class="plus" aria-hidden="true">＋</span><span class="label">安装</span>';

  hero.appendChild(brand);
  hero.appendChild(openButton);

  document.body.insertAdjacentHTML("beforeend", [
    '<div class="install-modal" id="install-modal" role="dialog" aria-modal="true" aria-labelledby="install-title" hidden>',
    '  <div class="install-card">',
    '    <div class="install-head">',
    "      <div>",
    '        <h2 id="install-title">添加桌面入口</h2>',
    '        <p id="install-lead">安装后可从桌面直接打开，使用体验接近原生 App。</p>',
    "      </div>",
    '      <button class="install-close" id="install-close" type="button" aria-label="关闭安装说明">×</button>',
    "    </div>",
    '    <ol class="install-steps" id="install-steps"></ol>',
    '    <div class="install-note" id="install-note" role="status">主屏入口打开的是当前网址对应的同一份程序，原有链接仍然可以继续访问。</div>',
    '    <button class="btn primary install-action" id="install-action" type="button" hidden></button>',
    "  </div>",
    "</div>"
  ].join(""));

  function detectBrowser() {
    var ua = navigator.userAgent || "";
    var platform = navigator.platform || "";
    var isIOS = /iPad|iPhone|iPod/i.test(ua) ||
      (platform === "MacIntel" && navigator.maxTouchPoints > 1);
    var isAndroid = /Android/i.test(ua);
    var isMobile = isIOS || isAndroid || /Mobile|Tablet|IEMobile|Opera Mini/i.test(ua);
    var appBrowsers = [
      ["wechat", "微信内置浏览器", /MicroMessenger/i],
      ["qq-app", "QQ 内置浏览器", /(?:^|\s)QQ\/[\d.]+/i],
      ["dingtalk", "钉钉内置浏览器", /DingTalk/i],
      ["alipay", "支付宝内置浏览器", /AlipayClient/i],
      ["weibo", "微博内置浏览器", /Weibo/i],
      ["douyin", "抖音内置浏览器", /aweme/i],
      ["baidu-app", "百度 App 内置浏览器", /baiduboxapp/i]
    ];
    var browserTypes = [
      ["huawei", "华为浏览器", /HuaweiBrowser|HBPC/i],
      ["mi", "小米浏览器", /MiuiBrowser|XiaoMiBrowser/i],
      ["vivo", "vivo 浏览器", /VivoBrowser/i],
      ["oppo", "OPPO 浏览器", /HeyTapBrowser|OppoBrowser/i],
      ["quark", "夸克浏览器", /Quark/i],
      ["uc", "UC 浏览器", /UCBrowser|UBrowser/i],
      ["qq-browser", "QQ 浏览器", /MQQBrowser/i],
      ["baidu", "百度浏览器", /BIDUBrowser|baidubrowser/i],
      ["edge", "Edge", /EdgA|EdgiOS|Edg\//i],
      ["opera", "Opera", /OPR\/|Opera|OPiOS/i],
      ["samsung", "Samsung Internet", /SamsungBrowser/i],
      ["firefox", "Firefox", /Firefox|FxiOS/i],
      ["chrome", "Chrome", /CriOS|Chrome|Chromium/i],
      ["safari", "Safari", /Safari/i]
    ];
    var i;
    var type;

    for (i = 0; i < appBrowsers.length; i += 1) {
      type = appBrowsers[i];
      if (type[2].test(ua)) {
        return makeBrowser(type[0], type[1], true, isIOS, isAndroid, isMobile);
      }
    }

    if (/; wv\)|\bWebView\b/i.test(ua)) {
      return makeBrowser("webview", "应用内置浏览器", true, isIOS, isAndroid, isMobile);
    }

    for (i = 0; i < browserTypes.length; i += 1) {
      type = browserTypes[i];
      if (type[2].test(ua)) {
        return makeBrowser(type[0], type[1], false, isIOS, isAndroid, isMobile);
      }
    }

    return makeBrowser("unknown", "当前浏览器", false, isIOS, isAndroid, isMobile);
  }

  function makeBrowser(id, label, embedded, isIOS, isAndroid, isMobile) {
    return {
      id: id,
      label: label,
      embedded: embedded,
      isIOS: isIOS,
      isAndroid: isAndroid,
      isMobile: isMobile
    };
  }

  function $(id) {
    return document.getElementById(id);
  }
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

  function setGuide(title, lead) {
    $("install-title").textContent = title;
    $("install-lead").textContent = lead;
  }

  function setNote(text, warning) {
    var note = $("install-note");
    note.className = warning ? "install-note warn" : "install-note";
    note.textContent = text;
  }

  function showAction(mode, label) {
    var action = $("install-action");
    action.hidden = false;
    action.disabled = false;
    action.dataset.action = mode;
    action.textContent = label;
  }

  function addSteps(items) {
    var list = $("install-steps");
    items.forEach(function (text, index) {
      list.appendChild(step(index + 1, text));
    });
  }

  function getInstallUrl() {
    var fallback = "https://LIUYE061.github.io/travel-list/?install=1";
    if (!/^https?:$/.test(location.protocol)) return fallback;
    var url = location.href.split("#")[0];
    if (!/[?&]install=1(?:&|$)/.test(url)) {
      url += (url.indexOf("?") === -1 ? "?" : "&") + "install=1";
    }
    return url;
  }

  function renderInstallGuide() {
    var action = $("install-action");
    var deviceName = browser.isMobile ? "手机" : "电脑";

    window.clearTimeout(actionTimer);
    clear($("install-steps"));
    action.hidden = true;
    action.disabled = false;
    action.dataset.action = "";
    setNote("主屏入口打开的是当前网址对应的同一份程序，原有链接仍然可以继续访问。", false);

    if (location.protocol === "file:") {
      setGuide("通过在线网址安装", "当前打开的是本地文件，手机或电脑桌面入口需要使用在线网址创建。");
      addSteps([
        "先复制 GitHub Pages 在线网址。",
        "在手机或电脑浏览器中打开该网址。",
        "再按当前浏览器菜单中的添加或安装步骤操作。"
      ]);
      setNote("在线网址：https://LIUYE061.github.io/travel-list/", true);
      showAction("copy", "复制在线安装网址");
      return;
    }

    if (browser.embedded) {
      setGuide("先转到系统浏览器", "当前是" + browser.label + "，应用内页面不能直接创建桌面入口。");
      addSteps([
        "点右上角菜单，选择“在浏览器中打开”或“用默认浏览器打开”。",
        "在 Safari、Chrome 或其他系统浏览器中打开本页。",
        "按浏览器菜单中的“安装应用”或“添加到主屏幕”完成添加。"
      ]);
      setNote("微信、QQ、钉钉等应用内浏览器不开放安装能力。复制下面的网址，粘贴到系统浏览器即可继续。", true);
      showAction("copy", "复制安装网址");
      return;
    }

    if (deferredPrompt) {
      setGuide("安装到" + deviceName, "当前浏览器支持一键安装，桌面入口会以独立窗口打开。");
      addSteps([
        "点下方“安装到" + deviceName + "”。",
        "在系统提示中确认安装。",
        "等待桌面出现“出行清单”图标，之后从桌面直接打开。"
      ]);
      showAction("prompt", "安装到" + deviceName);
      return;
    }

    if (browser.isIOS) {
      if (browser.id === "safari" || browser.id === "unknown") {
        setGuide("添加到 iPhone / iPad", "在 Safari 中通过分享菜单创建主屏幕入口。");
        addSteps([
          "点 Safari 底部或顶部的“分享”按钮。",
          "在分享菜单中找到并点“添加到主屏幕”。",
          "确认名称后点“添加”，之后从主屏幕启动。"
        ]);
      } else {
        setGuide("添加到 iPhone / iPad", "iOS 浏览器都使用系统 WebKit，请从分享或浏览器菜单创建主屏入口。");
        addSteps([
          "点" + browser.label + "的“分享”或“菜单”按钮。",
          "在系统分享菜单中向上滑动，选择“添加到主屏幕”。",
          "如果当前浏览器没有该选项，请复制网址并改用 Safari 添加。"
        ]);
      }
      setNote("主屏入口与浏览器标签页的本地数据各自独立。首次使用后，请固定从同一个入口打开。", false);
      showAction("copy", "复制安装网址");
      return;
    }

    if (browser.isAndroid) {
      setGuide("添加到 Android 主屏幕", "不同浏览器入口名称略有差异，请按当前浏览器的菜单操作。");
      if (browser.id === "samsung") {
        addSteps([
          "点 Samsung Internet 右下角的“菜单”。",
          "选择“添加页面至”，再选“主屏幕”。",
          "确认后，从手机桌面打开出行清单。"
        ]);
      } else if (browser.id === "firefox") {
        addSteps([
          "点 Firefox 右上角的“菜单”。",
          "选择“添加到主屏幕”或“添加页面快捷方式”。",
          "确认后，从手机桌面打开出行清单。"
        ]);
      } else if (browser.id === "chrome" || browser.id === "edge" || browser.id === "opera") {
        addSteps([
          "点浏览器右上角的“三点”菜单。",
          "选择“安装应用”，或“添加到主屏幕”。",
          "确认后，从手机桌面打开出行清单。"
        ]);
      } else {
        addSteps([
          "打开" + browser.label + "的主菜单。",
          "查找“安装应用”“添加到主屏幕”或“添加到桌面”。",
          "确认后，从手机桌面打开出行清单。"
        ]);
      }
      setNote("如果菜单中没有安装入口，该浏览器只支持普通书签；复制网址到 Chrome、Edge 或 Samsung Internet 可获得更完整的独立窗口体验。", true);
      showAction("copy", "复制安装网址");
      return;
    }

    setGuide("添加到电脑桌面", "当前浏览器可从菜单创建独立应用或网页快捷入口。");
    if (browser.id === "chrome" || browser.id === "edge" || browser.id === "opera") {
      addSteps([
        "查看地址栏右侧是否有安装图标；有则直接点击。",
        "也可打开浏览器菜单，选择“安装应用”或“创建快捷方式”。",
        "选择在窗口中打开，并从桌面或程序坞启动。"
      ]);
    } else if (browser.id === "safari") {
      addSteps([
        "在 Safari 菜单栏打开“文件”。",
        "选择“添加到程序坞”；旧版 macOS 可改用“分享”中的书签功能。",
        "之后从程序坞或书签直接打开出行清单。"
      ]);
    } else if (browser.id === "firefox") {
      addSteps([
        "将本页加入 Firefox 书签。",
        "需要桌面图标时，再从操作系统为该书签创建快捷方式。",
        "Firefox 桌面版不提供由网页触发的一键安装接口。"
      ]);
    } else {
      addSteps([
        "打开" + browser.label + "的主菜单。",
        "查找“安装应用”“创建快捷方式”或“添加到桌面”。",
        "若没有入口，请收藏本页作为网页快捷入口。"
      ]);
    }
    setNote("浏览器没有开放统一安装接口，网页不能绕过这一限制；复制网址可在支持原生安装的浏览器中继续。", true);
    showAction("copy", "复制安装网址");
  }

  function fallbackCopy(text) {
    var area = document.createElement("textarea");
    var copied = false;
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    area.style.top = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    if (area.setSelectionRange) area.setSelectionRange(0, area.value.length);
    try {
      copied = document.execCommand("copy");
    } catch (error) {
      copied = false;
    }
    document.body.removeChild(area);
    return copied;
  }

  function copyText(text, callback) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        navigator.clipboard.writeText(text).then(function () {
          callback(true);
        }, function () {
          callback(fallbackCopy(text));
        });
        return;
      } catch (error) {
        // Older WebViews can expose the API but throw before returning a promise.
      }
    }
    callback(fallbackCopy(text));
  }

  function copyInstallUrl() {
    var action = $("install-action");
    var url = getInstallUrl();
    copyText(url, function (copied) {
      window.clearTimeout(actionTimer);
      if (copied) {
        action.textContent = "网址已复制";
        actionTimer = window.setTimeout(function () {
          if (!$("install-modal").hidden) renderInstallGuide();
        }, 1800);
      } else {
        setNote("自动复制失败，请手动复制安装网址：" + url, true);
        window.prompt("请复制安装网址：", url);
      }
    });
  }

  function requestNativeInstall() {
    if (!deferredPrompt) {
      renderInstallGuide();
      return;
    }
    var prompt = deferredPrompt;
    var action = $("install-action");
    deferredPrompt = null;
    action.disabled = true;
    try {
      prompt.prompt();
    } catch (error) {
      renderInstallGuide();
      return;
    }
    if (!prompt.userChoice || typeof prompt.userChoice.then !== "function") {
      renderInstallGuide();
      return;
    }
    prompt.userChoice.then(function (choice) {
      if (choice.outcome === "accepted") {
        closeInstallGuide();
      } else {
        renderInstallGuide();
      }
    }, function () {
      renderInstallGuide();
    });
  }

  function openInstallGuide() {
    renderInstallGuide();
    $("install-modal").hidden = false;
    document.body.style.overflow = "hidden";
    $("install-close").focus();
  }

  function closeInstallGuide() {
    window.clearTimeout(actionTimer);
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
    if (this.dataset.action === "prompt") {
      requestNativeInstall();
    } else if (this.dataset.action === "copy") {
      copyInstallUrl();
    }
  });

  if (!isStandalone && /[?&]install=1(?:&|$)/.test(location.search)) {
    openInstallGuide();
  }

  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(function () {
        // Installation remains available even if offline caching is blocked.
      });
    });
  }
})();
