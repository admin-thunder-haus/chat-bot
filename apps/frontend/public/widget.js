/*
 * Web Chat widget loader — vanilla JS, no dependencies. Embed on any website:
 *
 *   <script src="https://YOUR_APP/widget.js" data-channel-key="wc_xxx" async></script>
 *
 * It injects a floating launcher (host DOM) + an iframe panel served from this
 * app's /widget/<key>?embed=1. The iframe drives the conversation and reports
 * unread + theme back via postMessage. No third-party libraries.
 */
(function () {
  var script =
    document.currentScript ||
    (function () {
      var s = document.getElementsByTagName('script');
      return s[s.length - 1];
    })();
  var key = script && script.getAttribute('data-channel-key');
  if (!key || window.__wcWidgetLoaded) return;
  window.__wcWidgetLoaded = true;

  var origin = new URL(script.src, window.location.href).origin;
  var panelUrl =
    origin + '/widget/' + encodeURIComponent(key) + '?embed=1';

  var wrap = document.createElement('div');
  wrap.setAttribute('id', 'wc-widget-root');
  wrap.style.cssText =
    'position:fixed;bottom:20px;right:20px;z-index:2147483000;font-family:system-ui,sans-serif;';

  var iframe = document.createElement('iframe');
  iframe.src = panelUrl;
  iframe.title = 'Chat';
  iframe.setAttribute('allow', 'clipboard-write');
  iframe.style.cssText =
    'border:0;width:min(92vw,380px);height:min(70vh,560px);border-radius:16px;' +
    'box-shadow:0 20px 50px rgba(0,0,0,.25);display:none;background:transparent;margin-bottom:12px;';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Open chat');
  btn.style.cssText =
    'width:56px;height:56px;border:0;border-radius:50%;background:#0f172a;color:#fff;' +
    'cursor:pointer;box-shadow:0 10px 24px rgba(0,0,0,.25);float:right;position:relative;' +
    'display:flex;align-items:center;justify-content:center;';

  var icon = document.createElement('span');
  icon.textContent = '💬';
  icon.style.fontSize = '24px';
  btn.appendChild(icon);

  var badge = document.createElement('span');
  badge.style.cssText =
    'position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;padding:0 4px;' +
    'border-radius:10px;background:#ef4444;color:#fff;font:700 11px system-ui;' +
    'display:none;align-items:center;justify-content:center;';
  btn.appendChild(badge);

  var open = false;
  function tellPanel(o) {
    try {
      iframe.contentWindow.postMessage({ type: 'webchat:visibility', open: o }, '*');
    } catch (e) {
      /* iframe not ready yet */
    }
  }
  function setOpen(o) {
    open = o;
    iframe.style.display = o ? 'block' : 'none';
    icon.textContent = o ? '✕' : '💬';
    btn.setAttribute('aria-label', o ? 'Close chat' : 'Open chat');
    if (o) badge.style.display = 'none';
    tellPanel(o);
  }
  btn.addEventListener('click', function () {
    setOpen(!open);
  });

  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'webchat:unread') {
      if (!open && d.count > 0) {
        badge.textContent = d.count > 9 ? '9+' : String(d.count);
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    } else if (d.type === 'webchat:ready') {
      if (d.color) btn.style.background = d.color;
      if (d.position === 'left') {
        wrap.style.left = '20px';
        wrap.style.right = 'auto';
        btn.style.float = 'left';
      }
    }
  });

  iframe.addEventListener('load', function () {
    tellPanel(open);
  });

  wrap.appendChild(iframe);
  wrap.appendChild(btn);

  function mount() {
    (document.body || document.documentElement).appendChild(wrap);
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
