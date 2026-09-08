export function bindNavigation() {
  const pages = [...document.querySelectorAll('[data-page]')];
  const links = [...document.querySelectorAll('.page-nav a')];
  function render() {
    const requested = location.hash.slice(1);
    const route = pages.some(page => page.dataset.page === requested) ? requested : 'monitor';
    for (const page of pages) page.hidden = page.dataset.page !== route;
    for (const link of links) {
      if (link.hash === `#${route}`) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    window.dispatchEvent(new Event('resize'));
  }
  window.addEventListener('hashchange', render);
  document.getElementById('expRegionLink').addEventListener('click', () => {
    const target = document.getElementById('selectionTarget');
    target.value = 'exp';
    target.dispatchEvent(new Event('change'));
  });
  render();
}
