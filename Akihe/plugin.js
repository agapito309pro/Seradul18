// Akihe — plugin de Kino para aki-h.com
// author: Hotaru Yume · creator: hotaruyume
// v1.0.0 — basado en el plugin Tiom (parsers robustos)

var BASE = 'https://aki-h.com';
var BROWSER_UA = 'Mozilla/5.0 (Linux; Android 13; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

// Slugs que son navegación, no series
var STOP_SLUGS = {
  '': 1, 'latest': 1, 'popular': 1, 'az-list': 1, 'search': 1, 'filter': 1,
  'genre': 1, 'genres': 1, 'watch': 1, 'video': 1, 'subtitles': 1, 'random': 1,
  'contact': 1, 'dmca': 1, 'privacy': 1, 'terms': 1
};

// ---------- utilidades ----------

function abs(u) {
  if (!u) return u;
  u = String(u).trim();
  if (u.indexOf('http:') === 0) u = 'https:' + u.slice(5);
  if (u.indexOf('https:') === 0) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (u.charAt(0) === '/') return BASE + u;
  return BASE + '/' + u;
}

function stripTags(s) {
  s = String(s || '').replace(/<[^>]*>/g, ' ');
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

function decodeEntities(s) {
  return String(s)
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (m, code) {
      if (code.charAt(0) === '#') {
        var n;
        if (code.charAt(1) === 'x' || code.charAt(1) === 'X') n = parseInt(code.slice(2), 16);
        else n = parseInt(code.slice(1), 10);
        return n > 0 && n < 65536 ? String.fromCharCode(n) : m;
      }
      var named = {
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
        aacute: '\u00e1', eacute: '\u00e9', iacute: '\u00ed', oacute: '\u00f3',
        uacute: '\u00fa', ntilde: '\u00f1', Ntilde: '\u00d1'
      };
      return named.hasOwnProperty(code) ? named[code] : m;
    });
}

function safeId(s) {
  return String(s || '').replace(/[^A-Za-z0-9._~-]/g, '-').slice(0, 100);
}

function imgFromBlock(block) {
  var m = String(block).match(/<img[^>]+(?:src|data-src|data-lazy-src)=[\"']([^\"']+)[\"']/i);
  return m ? abs(m[1]) : undefined;
}

async function fetchText(url, opts) {
  var o = opts || {};
  o.timeoutMs = o.timeoutMs || 14000;
  var h = {
    'User-Agent': BROWSER_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,ja;q=0.7,th;q=0.5',
    'Referer': BASE + '/'
  };
  if (o.headers) for (var k in o.headers) h[k] = o.headers[k];
  var res = await kino.fetch(url, {
    method: o.method || 'GET',
    headers: h,
    timeoutMs: o.timeoutMs,
    body: o.body
  });
  if (res.status < 200 || res.status >= 400) {
    throw kino.error('http', 'HTTP ' + res.status + ' en ' + url);
  }
  return res.body || '';
}

// ---------- parsers ----------

// Cards genéricas: <a href="/slug/">…<img …>…texto…</a>
function parseCards(html) {
  var out = [];
  var seen = {};
  var reA = /<a\s[^>]*href=[\"']\/([a-z0-9-]+)\/[\"'][^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = reA.exec(html))) {
    var slug = m[1];
    if (STOP_SLUGS[slug] || seen[slug]) continue;
    var block = m[2];
    var poster = imgFromBlock(block);
    var text = stripTags(block);
    if (!poster && !text) continue;
    var title = titleFromBlock(block) || altFromBlock(block) || text.slice(0, 120);
    if (!title || title.length < 2) title = slug.replace(/-/g, ' ');
    // evita bloques de navegación sin imagen y con texto muy corto
    if (!poster && title.length < 12) continue;
    seen[slug] = 1;
    out.push({
      id: ('s~' + safeId(slug)).slice(0, 128),
      ref: 'S|' + slug,
      kind: 'series',
      title: title.slice(0, 200),
      poster: poster,
      lang: 'en',
      adult: true
    });
  }
  return out;
}

function titleFromBlock(block) {
  var m = String(block).match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  if (m) return stripTags(m[1]);
  return '';
}

function altFromBlock(block) {
  var m = String(block).match(/alt=[\"']([^\"']+)[\"']/i);
  return m ? stripTags(m[1]) : '';
}

// Episodios: <a href="/watch/CODE/">…</a>
function parseEpisodesFromHtml(html, seriesTitle) {
  var out = [];
  var seen = {};
  var re = /<a\s[^>]*href=[\"']\/watch\/([A-Za-z0-9]+)\/?[\"'][^>]*>([\s\S]*?)<\/a>/gi;
  var m, idx = 0;
  while ((m = re.exec(html))) {
    var code = m[1];
    if (seen[code]) continue;
    seen[code] = 1;
    var text = stripTags(m[2]) || ('Episodio ' + (idx + 1));
    var num = episodeNumber(text) || 0;
    if (!(num > 0)) num = idx + 1;
    idx++;
    out.push({
      season: 1,
      number: num,
      ref: 'E|' + code,
      title: text.slice(0, 200) || ((seriesTitle ? seriesTitle + ' ' : '') + 'Ep. ' + num)
    });
  }
  // ordenar conservando estables
  out.sort(function (a, b) { return a.number - b.number; });
  return out;
}

function episodeNumber(s) {
  var m = String(s).match(/(?:vol|ep|eps|episode|chapter|capitulo|cap\.?|ตอนที่?)\s*[-_ ]*(\d{1,4})/i);
  if (m) return parseInt(m[1], 10);
  m = String(s).match(/(\d{1,4})\s*$/);
  if (m) return parseInt(m[1], 10);
  return 0;
}

// ---------- home / search / browse ----------

export async function home() {
  var rows = [];
  try {
    var html = await fetchText(BASE + '/latest/');
    var items = parseCards(html).slice(0, 48);
    if (items.length) rows.push({ id: 'r~ultimos', title: 'Últimos Añadidos', items: items, ref: 'B|latest' });
  } catch (e) {}

  try {
    var popHtml = await fetchText(BASE + '/popular/');
    var popItems = parseCards(popHtml).slice(0, 48);
    if (popItems.length) rows.push({ id: 'r~populares', title: 'Más Populares', items: popItems, ref: 'B|popular' });
  } catch (e) {}

  try {
    var homeHtml = await fetchText(BASE + '/');
    var trending = parseCards(homeHtml);
    // en la home aparecen series nuevas; fuerza filas solo si no duplican
    var fresh = [];
    var have = {};
    rows.forEach(function (r) { r.items.forEach(function (it) { have[it.ref] = 1; }); });
    trending.forEach(function (it) { if (!have[it.ref]) fresh.push(it); });
    if (fresh.length >= 6) {
      rows.splice(0, 0, { id: 'r~nuevos', title: 'Destacados', items: fresh.slice(0, 48), ref: 'B|latest' });
    }
  } catch (e) {}

  return rows;
}

export async function search(query) {
  var q = (query && query.q) ? String(query.q).trim() : '';
  if (!q) return { items: [] };
  var page = 1;
  if (query.cursor) {
    var cm = String(query.cursor).match(/p=(\d+)/);
    if (cm) page = parseInt(cm[1], 10) || 1;
  }
  var url = BASE + '/search/?q=' + encodeURIComponent(q);
  try {
    if (page > 1) url = BASE + '/search/page/' + page + '/?q=' + encodeURIComponent(q);
    var html = await fetchText(url);
    var items = parseCards(html);
    if (!items.length) {
      // último recurso: filtrar el sitemap por slug
      items = await sitemapSearch(q);
    }
    var next = null;
    if (items.length >= 12) next = 'p=' + (page + 1);
    return { items: items.slice(0, 60), next: next };
  } catch (e) {
    var items2 = await sitemapSearch(q);
    return { items: items2.slice(0, 60) };
  }
}

var sitemapCache = { t: 0, slugs: [] };

async function loadSitemapSlugs() {
  if (Date.now() - sitemapCache.t > 10 * 60 * 1000 || !sitemapCache.slugs.length) {
    try {
      var sm = await fetchText(BASE + '/sitemap.xml', { timeoutMs: 16000 });
      var slugs = [];
      var re = /<loc>https?:\/\/aki-h\.com\/([a-z0-9-]+)\/<\/loc>/gi;
      var m;
      while ((m = re.exec(sm))) {
        if (!STOP_SLUGS[m[1]] && slugs.indexOf(m[1]) < 0) slugs.push(m[1]);
      }
      sitemapCache.t = Date.now();
      sitemapCache.slugs = slugs;
    } catch (e) {}
  }
  return sitemapCache.slugs;
}

async function sitemapSearch(q) {
  var slugs = await loadSitemapSlugs();
  var ql = q.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  return slugs
    .map(function (slug) {
      var words = slug.toLowerCase().replace(/-/g, ' ');
      var score = 0;
      ql.forEach(function (w) { if (words.indexOf(w) >= 0) score++; });
      return { slug: slug, score: score };
    })
    .filter(function (x) { return x.score > 0; })
    .sort(function (a, b) { return b.score - a.score; })
    .map(function (x) {
      return {
        id: ('s~' + safeId(x.slug)).slice(0, 128),
        ref: 'S|' + x.slug,
        kind: 'series',
        title: x.slug.replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }).slice(0, 200),
        lang: 'en',
        adult: true
      };
    });
}

export async function browse(ref, cursor) {
  var page = 1;
  if (cursor) {
    var cm = String(cursor).match(/p=(\d+)/);
    if (cm) page = parseInt(cm[1], 10) || 1;
  }
  var path = 'latest';
  var r = String(ref || '');
  if (r.indexOf('B|') === 0) r = r.slice(2);
  if (r === 'popular') path = 'popular';
  else if (r === 'az') path = 'az-list';
  else if (r.indexOf('genre:') === 0) path = 'genre/' + r.slice(6);
  else if (r.charAt(0) === '/') path = r.replace(/^\//, '');

  var url = BASE + '/' + path + '/';
  if (page > 1) url = BASE + '/' + path + '/page/' + page + '/';

  var html = await fetchText(url);
  var items = parseCards(html);
  if (!items.length && path === 'az-list') {
    // A-Z: si no hay cards, lista plana de enlaces
    items = parseCards(html.replace(/<img[^>]*>/gi, '<img data-x>'));
  }
  var next = null;
  if (items.length >= 12) next = 'p=' + (page + 1);
  return { items: items.slice(0, 60), next: next };
}

// ---------- ficha + episodios ----------

export async function episodes(ref) {
  var r = String(ref || '');
  if (r.indexOf('S|') === 0) r = r.slice(2);
  else if (r.indexOf('E|') === 0) return { episodes: [] };
  var slug = r.replace(/^\//, '').replace(/\/$/, '');

  var html = await fetchText(BASE + '/' + encodeURIComponent(slug) + '/');
  var title = '';
  var tm = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (tm) title = stripTags(tm[1]);
  if (!title) title = slug.replace(/-/g, ' ');
  var poster = imgFromBlock(html);
  var overview = '';
  var om = html.match(/<p[^>]*class=[\"'][^\"']*(?:sinopsis|description|story|content)[^\"']*[\"'][^>]*>([\s\S]*?)<\/p>/i)
    || html.match(/<div[^>]*class=[\"'][^\"']*(?:description|story)[^\"']*[\"'][^>]*>([\s\S]*?)<\/div>/i);
  if (om) overview = stripTags(om[1]).slice(0, 600);

  var eps = parseEpisodesFromHtml(html, title);
  // si la ficha no trae la lista completa, probar el bloque de episodios vía /watch/
  if (!eps.length) {
    try {
      var w = await fetchText(BASE + '/watch/' + (firstWatchCode(html) || '') + '/');
      eps = parseEpisodesFromHtml(w, title);
    } catch (e) {}
  }

  return {
    series: {
      title: title,
      poster: poster,
      overview: overview || undefined
    },
    episodes: eps
  };
}

function firstWatchCode(html) {
  var m = String(html).match(/href=[\"']\/watch\/([A-Za-z0-9]+)\/?[\"']/i);
  return m ? m[1] : '';
}

// ---------- resolve ----------

export async function resolve(ref) {
  var r = String(ref || '');
  if (r.indexOf('E|') === 0) r = r.slice(2);
  else if (r.indexOf('S|') === 0) {
    throw kino.error('resolve', 'Este ítem es una serie; abre un episodio.');
  }
  var code = String(r).replace(/^\//, '').replace(/\/$/, '');
  if (!/^[A-Za-z0-9_-]+$/.test(code)) {
    throw kino.error('resolve', 'Referencia de episodio inválida.');
  }

  var pageUrl = BASE + '/watch/' + code + '/';
  var html = '';
  try { html = await fetchText(pageUrl); } catch (e) {}

  var primary = null;
  var alternatives = [];

  // 1) iframes / embeds conocidos dentro de la página del reproductor
  var embeds = [];
  var reEmb = /https?:\/\/(?!(?:[a-z0-9-]+\.)?aki-h\.com)[a-z0-9.-]+\.[a-z]{2,}\/(?:e(?:mbed)?s?|embed|video|d|v)\/[^\s\"'<>]+/gi;
  var m;
  while ((m = reEmb.exec(html))) {
    var u = m[0].replace(/&amp;/g, '&');
    if (/\.(?:png|jpe?g|gif|css|js)(?:[?#]|$)/i.test(u)) continue;
    if (embeds.indexOf(u) < 0) embeds.push(u);
  }

  // 2) mp4 / m3u8 directos en la página
  var direct = null;
  var dm = html.match(/[\"']((?:https?:\/\/|https?:\\?\/\\?\/)[^\s\"']+\.m3u8[^\s\"']*)[\"']/i);
  if (!dm) dm = html.match(/[\"'](https?:\/\/[^\s\"']+\.mp4[^\s\"']*)[\"']/i);
  if (dm) {
    direct = { url: dm[1].replace(/\\/g, ''), label: 'Directo' };
  }

  // 3) resolvers por host de embed
  for (var i = 0; i < embeds.length && !primary; i++) {
    var emb = embeds[i];
    var stream = null;
    try {
      if (/filemoon|moonplayer/i.test(emb)) stream = await resolveM3U8Embed(emb, 'Filemoon');
      else if (/mp4upload/i.test(emb)) stream = await resolveMp4Upload(emb);
      else stream = await resolveGenericEmbed(emb);
    } catch (e) {}
    if (stream && stream.url) {
      if (/malosas|stripchat|adsco|creative\./i.test(stream.url)) continue;
      if (!primary) primary = stream;
      else alternatives.push(stream);
    }
  }

  if (direct) {
    if (!primary) primary = direct;
    else alternatives.push(direct);
  }

  // 4) gateway propio del sitio: /video/{code}/ (redirige al mp4)
  var gw = BASE + '/video/' + code + '/';
  var gwStream = { url: gw, mime: 'video/mp4', label: 'Aki-H' };
  if (!primary) {
    // comprobar que responde antes de proclamarlo primario
    try {
      var g = await kino.fetch(gw, { method: 'GET', headers: { 'User-Agent': BROWSER_UA, 'Referer': pageUrl, 'Range': 'bytes=0-1' }, timeoutMs: 12000 });
      if (g.status >= 300 && g.status < 400 && g.headers && (g.headers.location || g.headers.Location)) {
        var loc = abs(g.headers.location || g.headers.Location);
        gwStream = { url: loc, mime: /\.m3u8/i.test(loc) ? 'application/x-mpegURL' : 'video/mp4', label: 'Aki-H' };
      }
      primary = gwStream;
    } catch (e) {
      primary = gwStream; // igualmente permitir que el reproductor lo intente
    }
  } else {
    alternatives.push(gwStream);
  }

  if (!primary) {
    throw kino.error('resolve', 'No se encontró un stream reproducible. Prueba más tarde.');
  }

  var out = {
    url: primary.url,
    mime: primary.mime || (primary.url.indexOf('.m3u8') >= 0 ? 'application/x-mpegURL' : 'video/mp4'),
    label: primary.label || 'Aki-H',
    headers: { 'User-Agent': BROWSER_UA, 'Referer': BASE + '/' }
  };
  if (alternatives.length) out.alternatives = alternatives.slice(0, 6);
  return out;
}

async function resolveGenericEmbed(embedUrl) {
  var html = await fetchText(embedUrl, { timeoutMs: 12000, headers: { 'Referer': BASE + '/' } });
  var m = html.match(/[\"'](https?:\/\/[^\"']+\.m3u8[^\"']*)[\"']/i);
  if (m) return { url: m[1], mime: 'application/x-mpegURL', label: hostLabel(embedUrl) };
  m = html.match(/[\"'](https?:\/\/[^\"']+\.mp4[^\"']*)[\"']/i);
  if (m) return { url: m[1], mime: 'video/mp4', label: hostLabel(embedUrl) };
  m = html.match(/sources?\s*:\s*\[\s*\{[^}]*?(?:src|file)\s*:\s*[\"'](https?:\/\/[^\"']+)[\"']/i);
  if (m) return { url: m[1], mime: /\.m3u8/i.test(m[1]) ? 'application/x-mpegURL' : 'video/mp4', label: hostLabel(embedUrl) };
  m = html.match(/window\.location\.href\s*=\s*['\"](https?:\/\/[^'\"]+)['\"]/);
  if (m) {
    var h2 = await fetchText(m[1], { timeoutMs: 10000, headers: { 'Referer': BASE + '/' } });
    var m2 = h2.match(/[\"'](https?:\/\/[^\"']+\.m3u8[^\"']*)[\"']/i) || h2.match(/[\"'](https?:\/\/[^\"']+\.mp4[^\"']*)[\"']/i);
    if (m2) return { url: m2[1], mime: /\.m3u8/i.test(m2[1]) ? 'application/x-mpegURL' : 'video/mp4', label: hostLabel(m[1]) };
  }
  return null;
}

async function resolveM3U8Embed(embedUrl, label) {
  var html = await fetchText(embedUrl, { timeoutMs: 12000, headers: { 'Referer': embedUrl } });
  var m = html.match(/[\"'](?:src|file|sources?)\s*:\s*[\"']([^\"']+\.m3u8[^\"']*)[\"']/i)
    || html.match(/[\"'](https?:\/\/[^\s\"']+\.m3u8[^\s\"']*)[\"']/i);
  if (m) return { url: m[1], mime: 'application/x-mpegURL', label: label };
  m = html.match(/atob\s*\(\s*[\"']([A-Za-z0-9+/=]{20,})[\"']\s*\)/);
  if (m) {
    try {
      var dec = atob(m[1]);
      var um = dec.match(/https?:\/\/[^\s\"'<>]+\.m3u8[^\s\"'<>]*/i);
      if (um) return { url: um[0], mime: 'application/x-mpegURL', label: label };
    } catch (e) {}
  }
  return null;
}

async function resolveMp4Upload(embedUrl) {
  var html = await fetchText(embedUrl, { timeoutMs: 12000, headers: { 'Referer': BASE + '/' } });
  var m = html.match(/sources?\s*:\s*\[\s*\{[^}]*?src\s*:\s*[\"'](https?:\/\/[^\"']+)[\"']/i)
    || html.match(/[\"'](https?:\/\/[^\"']*mp4upload[^\"']*\.mp4[^\"']*)[\"']/i);
  if (m) return { url: m[1], mime: 'video/mp4', label: 'Mp4Upload' };
  return null;
}

function hostLabel(u) {
  var m = String(u).match(/https?:\/\/(?:www\.)?([a-z0-9.-]+)\//i);
  return m ? m[1] : 'Embed';
}
