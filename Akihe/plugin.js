// Akihe — plugin de Kino para aki-h.com
// author: Hotaru Yume · creator: hotaruyume
// v1.1.0 — parsers ajustados al HTML real (ak-card, /episode/, /videos/, relay v.aki-h.com → aki-h.stream)

var BASE = 'https://aki-h.com';
var BROWSER_UA = 'Mozilla/5.0 (Linux; Android 13; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

var STOP_SLUGS = {
  '': 1, 'latest': 1, 'popular': 1, 'az-list': 1, 'search': 1, 'filter': 1,
  'genre': 1, 'genres': 1, 'watch': 1, 'video': 1, 'videos': 1, 'episode': 1,
  'subtitles': 1, 'random': 1, 'category': 1, 'categories': 1, 'studio': 1,
  'sound': 1, 'contact': 1, 'dmca': 1, 'privacy': 1, 'terms': 1
};

// hosts de imágenes legítimas (excluye banners de publicidad)
var IMG_HOST_RE = /https?:\/\/(?:i|t)\.aki-h\.com\/[^\s"'<>]+\.(?:webp|jpg|jpeg|png)/i;

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

function attrFrom(tag, name) {
  var m = String(tag).match(new RegExp(name + '=["\']([^"\']*)["\']', 'i'));
  return m ? decodeEntities(m[1]) : '';
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

// Card real del sitio:
//   <div class="ak-card">…<a href="/slug/" title="Título"><img src="https://i.aki-h.com/..."></a>
//   <h3 class="ak-card__title"><a href="/slug/">Título</a></h3></div>
function parseCards(html) {
  var out = [];
  var seen = {};

  // 1) método fiable: título en h3.ak-card__title + poster cercano del propio host
  var reT = /<h3[^>]*class=["'][^"']*ak-card__title[^"']*["'][^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = reT.exec(html))) {
    var href = m[1];
    var title = stripTags(m[2]);
    if (!title) continue;
    var slug = slugFromHref(href);
    if (!slug || seen[slug]) continue;
    // buscar el poster: el <img> del host propio más cercano antes del título
    var poster = nearestPoster(html, m.index);
    seen[slug] = 1;
    out.push(makeSeries(slug, title, poster));
  }

  // 2) fallback: <a> con imagen de i.aki-h.com dentro, título en title/alt
  if (!out.length) {
    var reA = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = reA.exec(html))) {
      var href2 = m[1];
      var block = m[2];
      if (!IMG_HOST_RE.test(block)) continue;
      var slug2 = slugFromHref(href2);
      if (!slug2 || seen[slug2]) continue;
      var openTag = m[0].slice(0, m[0].indexOf('>') + 1);
      var title2 = attrFrom(openTag, 'title')
        || attrFrom(block, 'alt')
        || stripTags(block).replace(/^EP[^A-Za-z]*/i, '')
        || slug2.replace(/-/g, ' ');
      if (!title2 || title2.length < 2) continue;
      var poster2 = (block.match(IMG_HOST_RE) || [undefined])[0];
      seen[slug2] = 1;
      out.push(makeSeries(slug2, title2, poster2 ? abs(poster2) : undefined));
    }
  }
  return out;
}

function slugFromHref(href) {
  var h = String(href || '');
  var m = h.match(/^https?:\/\/(?:[a-z0-9-]+\.)*aki-h\.com\/([a-z0-9-]+)\/?$/i) || h.match(/^\/([a-z0-9-]+)\/?$/);
  if (!m) return '';
  var slug = m[1];
  if (STOP_SLUGS[slug] || /^genre\//.test(slug)) return '';
  return slug;
}

function nearestPoster(html, idx) {
  // ventana previa al título donde vive la imagen de la card
  var start = Math.max(0, idx - 1200);
  var window = html.slice(start, idx + 300);
  var m = window.match(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi);
  if (!m) return undefined;
  for (var i = m.length - 1; i >= 0; i--) {
    var src = attrFrom(m[i], 'src');
    if (IMG_HOST_RE.test(src)) return abs(src);
  }
  return undefined;
}

function makeSeries(slug, title, poster) {
  return {
    id: ('s~' + safeId(slug)).slice(0, 128),
    ref: 'S|' + slug,
    kind: 'series',
    title: title.slice(0, 200),
    poster: poster,
    lang: 'en',
    adult: true
  };
}

// Episodios reales: en /episode/{slug}/ son <a href="/videos/{CODE}/" title="Título">
function parseEpisodes(html, seriesTitle) {
  var out = [];
  var seen = {};
  var re = /<a\s[^>]*href=["'][^"']*\/videos\/([A-Za-z0-9]+)\/?["'][^>]*>/gi;
  var m, idx = 0;
  while ((m = re.exec(html))) {
    var code = m[1];
    if (seen[code]) continue;
    seen[code] = 1;
    var openTag = m[0];
    var text = attrFrom(openTag, 'title');
    if (!text) {
      // título en el h3 inmediatamente posterior
      var after = html.slice(m.index, m.index + 1200);
      var tm = after.match(/<h3[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
      text = tm ? stripTags(tm[1]) : '';
    }
    if (!text) text = (seriesTitle ? seriesTitle + ' ' : '') + 'Ep. ' + (idx + 1);
    var num = episodeNumber(text) || (idx + 1);
    idx++;
    out.push({
      season: 1,
      number: num,
      ref: 'E|' + code,
      title: text.slice(0, 200),
      poster: abs('https://t.aki-h.com/thumbnail/' + code + '.webp')
    });
  }
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
    var latestHtml = await fetchText(BASE + '/latest/');
    var latest = parseCards(latestHtml).slice(0, 48);
    if (latest.length) rows.push({ id: 'r~ultimos', title: 'Últimos Añadidos', items: latest, ref: 'B|latest' });
  } catch (e) {}

  try {
    var popHtml = await fetchText(BASE + '/popular/');
    var pop = parseCards(popHtml).slice(0, 48);
    if (pop.length) rows.push({ id: 'r~populares', title: 'Más Populares', items: pop, ref: 'B|popular' });
  } catch (e) {}

  // si /latest/ y /popular/ fallan, usar la portada
  if (!rows.length) {
    try {
      var homeHtml = await fetchText(BASE + '/');
      var cards = parseCards(homeHtml).slice(0, 48);
      if (cards.length) rows.push({ id: 'r~home', title: 'Destacados', items: cards, ref: 'B|latest' });
    } catch (e) {}
  }

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
  if (page > 1) url += '&page=' + page;
  var html = await fetchText(url);
  var items = parseCards(html);
  if (!items.length) {
    items = await sitemapSearch(q);
  }
  var next = null;
  if (items.length >= 12) next = 'p=' + (page + 1);
  return { items: items.slice(0, 60), next: next };
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
      return makeSeries(x.slug, x.slug.replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }));
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
  var poster = nearestPoster(html, 0);

  var overview = '';
  var om = html.match(/<p[^>]*class=["'][^"']*(?:sinopsis|description|story|content)[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)
    || html.match(/<div[^>]*class=["'][^"']*(?:description|story)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (om) overview = stripTags(om[1]).slice(0, 600);

  // lista completa en /episode/{slug}/
  var eps = [];
  try {
    var epHtml = await fetchText(BASE + '/episode/' + encodeURIComponent(slug) + '/');
    eps = parseEpisodes(epHtml, title);
  } catch (e) {}
  if (!eps.length) eps = parseEpisodes(html, title);

  return {
    series: {
      title: title,
      poster: poster,
      overview: overview || undefined
    },
    episodes: eps
  };
}

// ---------- resolve ----------
// Cadena real del sitio (verificada contra scrapers públicos de aki-h.com):
//   1) página del episodio: /videos/{code}/  →  displayvideo(N, PID)
//   2) relay: https://v.aki-h.com/f/{code}  (Referer: https://v.aki-h.com/v/{PID})
//   3) el relay trae <script id="boot"> con JSON servers[] → urls en streaming.aki.today
//   4) cada url de servidor contiene aki-h.stream/v/{token}
//   5) stream final: https://aki-h.stream/file/{token}/  (m3u8, Referer aki-h.stream/v/{token})

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

  var pageUrl = BASE + '/videos/' + code + '/';
  var page = await fetchText(pageUrl);

  // PID del player (displayvideo(1, 12345))
  var pid = '';
  var pm = page.match(/displayvideo\s*\(\s*\d+\s*,\s*(\d+)\s*\)/i);
  if (pm) pid = pm[1];

  var relayUrl = 'https://v.aki-h.com/f/' + code;
  var refV = pid ? 'https://v.aki-h.com/v/' + pid : pageUrl;

  var relay = '';
  try {
    relay = await fetchText(relayUrl, { headers: { 'Referer': refV }, timeoutMs: 12000 });
  } catch (e) {}

  // ruta alternativa: /video2/{pid}/ expone 'url': 'https://v.aki-h.com/v/NNN'
  if (!relay && pid) {
    try {
      var playerUrl = BASE + '/video2/' + pid + '/';
      var player = await fetchText(playerUrl, { headers: { 'Referer': pageUrl }, timeoutMs: 12000 });
      var um = player.match(/["']url["']\s*:\s*["']([^"']*v\.aki-h\.com\/v\/\d+)/i);
      if (um) {
        refV = abs(um[1]);
        relay = await fetchText(relayUrl, { headers: { 'Referer': refV }, timeoutMs: 12000 });
      }
    } catch (e) {}
  }

  // servidores desde el boot JSON del relay
  var serverUrls = [];
  var bm = relay.match(/<script[^>]*id=["']boot["'][^>]*>([\s\S]*?)<\/script>/i);
  if (bm) {
    try {
      var boot = JSON.parse(bm[1]);
      (boot.servers || []).forEach(function (s) {
        if (s && s.url && /streaming\.aki\.today/.test(s.url)) serverUrls.push(s.url);
      });
    } catch (e) {}
  }
  if (!serverUrls.length) {
    var reS = /https:\/\/streaming\.aki\.today\/[^\s"'<>]+/gi;
    var sm;
    while ((sm = reS.exec(relay))) serverUrls.push(sm[0]);
  }

  var primary = null;
  var alternatives = [];

  for (var i = 0; i < serverUrls.length; i++) {
    try {
      var sr = await fetchText(serverUrls[i], { headers: { 'Referer': relayUrl }, timeoutMs: 12000 });
      var tk = sr.match(/aki-h\.stream\/v\/([^"'/?#]+)/i);
      if (tk) {
        var token = tk[1];
        var stream = {
          url: 'https://aki-h.stream/file/' + token + '/',
          mime: 'application/x-mpegURL',
          label: 'Aki-H HD',
          headers: {
            'User-Agent': BROWSER_UA,
            'Referer': 'https://aki-h.stream/v/' + token,
            'Accept': '*/*'
          }
        };
        if (!primary) primary = stream;
        else if (alternatives.length < 5) alternatives.push(stream);
      }
    } catch (e) {}
  }

  // fallback: embeds externos en la página del episodio
  if (!primary) {
    var reEmb = /https?:\/\/(?!(?:[a-z0-9-]+\.)*aki-h\.com)[a-z0-9.-]+\.[a-z]{2,}\/(?:e(?:mbed)?s?|embed|video|d|v)\/[^\s"'<>]+/gi;
    var em;
    while ((em = reEmb.exec(page))) {
      var emb = em[0].replace(/&amp;/g, '&');
      if (/\.(?:png|jpe?g|gif|webp|css|js)(?:[?#]|$)/i.test(emb)) continue;
      try {
        var g = await resolveGenericEmbed(emb);
        if (g && g.url) { primary = g; break; }
      } catch (e) {}
    }
  }

  if (!primary) {
    throw kino.error('resolve', 'No se pudo resolver el stream. Prueba más tarde.');
  }

  var out = {
    url: primary.url,
    mime: primary.mime || 'application/x-mpegURL',
    label: primary.label || 'Aki-H'
  };
  if (primary.headers) out.headers = primary.headers;
  if (alternatives.length) out.alternatives = alternatives.slice(0, 5);
  return out;
}

async function resolveGenericEmbed(embedUrl) {
  var html = await fetchText(embedUrl, { timeoutMs: 12000, headers: { 'Referer': BASE + '/' } });
  var m = html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
  if (m) return { url: m[1], mime: 'application/x-mpegURL', label: hostLabel(embedUrl), headers: { 'User-Agent': BROWSER_UA, 'Referer': embedUrl } };
  m = html.match(/["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
  if (m) return { url: m[1], mime: 'video/mp4', label: hostLabel(embedUrl), headers: { 'User-Agent': BROWSER_UA, 'Referer': embedUrl } };
  m = html.match(/sources?\s*:\s*\[\s*\{[^}]*?(?:src|file)\s*:\s*["'](https?:\/\/[^"']+)["']/i);
  if (m) {
    var u = m[1];
    return {
      url: u,
      mime: /\.m3u8/i.test(u) ? 'application/x-mpegURL' : 'video/mp4',
      label: hostLabel(embedUrl),
      headers: { 'User-Agent': BROWSER_UA, 'Referer': embedUrl }
    };
  }
  return null;
}

function hostLabel(u) {
  var m = String(u).match(/https?:\/\/(?:www\.)?([a-z0-9.-]+)\//i);
  return m ? m[1] : 'Embed';
}
