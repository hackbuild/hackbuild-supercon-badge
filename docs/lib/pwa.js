// Registers the service worker and offers installing the site as an app. A classic script, so
// every page can load it with one tag, file:// included, where registration is skipped.
// window.hbPwa.mount(el) fills el with the install button, or the iphone steps, or nothing.
(() => {
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  // iPadOS reports itself as a Mac, so touch points tell them apart.
  const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let offer = null;
  const mounted = new Set();

  addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    offer = e;
    mounted.forEach(draw);
  });
  addEventListener('appinstalled', () => {
    offer = null;
    mounted.forEach(draw);
  });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(e => console.warn('service worker not registered', e));
    });
  }

  function draw(el) {
    el.replaceChildren();
    if (standalone()) {
      el.append(Object.assign(document.createElement('p'), { className: 'small', textContent: 'running as an installed app.' }));
    } else if (offer) {
      const b = Object.assign(document.createElement('button'), { className: 'btn', type: 'button', textContent: 'install as an app' });
      b.addEventListener('click', async () => {
        const e = offer;
        offer = null;
        try { await e.prompt(); await e.userChoice; } catch (err) { /* the prompt can be used once */ }
        draw(el);
      });
      el.append(b);
    } else if (ios()) {
      el.append(Object.assign(document.createElement('p'), { className: 'small', textContent: 'to install on an iphone or ipad, tap share, then add to home screen.' }));
    }
  }

  window.hbPwa = { mount(el) { mounted.add(el); draw(el); } };
})();
