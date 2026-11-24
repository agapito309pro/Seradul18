// TioHentai — plugin de Kino para tiohentai.com
// author: Hotaru Yume · creator: hotaruyume

var BASE = 'https://tiohentai.com';
var BROWSER_UA = 'Mozilla/5.0 (Linux; Android 13; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

// Prioridad de servidores: YourUpload (MP4 directo, rápido) > Voe > Mega al final
var PRIO = ['yourupload', 'voe', 'mega'];

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
        uacute: '\u00fa', ntilde: '\u00f1', Ntilde: '\u00d1', uuml: '\u00fc'
      };
      return named.hasOwnProperty(code) ? named[code] : m;
    });
}

function safeId(s) {
  return String(s || '').replace(/[^A-Za-z0-9._~-]/g, '-').slice(0, 100);
}

function firstImg(html) {
  var m = String(html).match(/<img[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["']/i);
  return m ? abs(m[1]) : undefined;
}

async function fetchText(url, opts) {
  var o = opts || {};
  o.timeoutMs = o.timeoutMs || 14000;
  var h = { 'User-Agent': BROWSER_UA, 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.5' };
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

function parseEpisodeCards(html) {
  var out = [];
  var re = /<a\s+href=["'](\/ver\/([^"'?#]+))["'][^>]*>[\s\S]*?(?:<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>)?[\s\S]*?<h3[^>]*class=["']title["'][^>]*>([\s\S]*?)<\/h3>/gi;
  var m;
  while ((m = re.exec(html))) {
    var slug = m[2];
    var title = stripTags(m[4]);
    if (!slug || !title) continue;
    out.push({
      id: ('e~' + safeId(slug)).slice(0, 128),
      ref: 'E|' + slug,
      kind: 'movie',
      title: title.slice(0, 200),
      poster: m[3] ? abs(m[3]) : undefined,
      lang: 'es',
      adult: true
    });
  }
  // fallback más permisivo
  if (!out.length) {
    re = /<a\s+href=["'](\/ver\/([^"'?#]+))["'][^>]*>[\s\S]*?<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>[\s\S]*?(?:<h3[^>]*>|title=["'])([^<"']+)/gi;
    while ((m = re.exec(html))) {
      var slug2 = m[2];
      var title2 = stripTags(m[4]);
      if (!slug2 || !title2 || title2.length < 2) continue;
      out.push({
        id: ('e~' + safeId(slug2)).slice(0, 128),
        ref: 'E|' + slug2,
        kind: 'movie',
        title: title2.slice(0, 200),
        poster: m[3] ? abs(m[3]) : undefined,
        lang: 'es',
        adult: true
      });
    }
  }
  return dedupe(out);
}

function parseSeriesCards(html) {
  var out = [];
  var re = /<a\s+href=["'](\/hentai\/([^"'?#]+))["'][^>]*>[\s\S]*?(?:<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>)?[\s\S]*?<h3[^>]*class=["']title["'][^>]*>([\s\S]*?)<\/h3>/gi;
  var m;
  while ((m = re.exec(html))) {
    var slug = m[2];
    var title = stripTags(m[4]);
    if (!slug || !title) continue;
    out.push({
      id: ('s~' + safeId(slug)).slice(0, 128),
      ref: 'S|' + slug,
      kind: 'series',
      title: title.slice(0, 200),
      poster: m[3] ? abs(m[3]) : undefined,
      lang: 'es',
      adult: true
    });
  }
  if (!out.length) {
    re = /<a\s+href=["'](\/hentai\/([^"'?#]+))["'][^>]*>[\s\S]*?<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>[\s\S]*?(?:<h3[^>]*>|title=["'])([^<"']+)/gi;
    while ((m = re.exec(html))) {
      var slug2 = m[2];
      var title2 = stripTags(m[4]);
      if (!slug2 || !title2 || title2.length < 2) continue;
      out.push({
        id: ('s~' + safeId(slug2)).slice(0, 128),
        ref: 'S|' + slug2,
        kind: 'series',
        title: title2.slice(0, 200),
        poster: m[3] ? abs(m[3]) : undefined,
        lang: 'es',
        adult: true
      });
    }
  }
  return dedupe(out);
}

function dedupe(items) {
  var seen = {}, out = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (seen[it.ref]) continue;
    seen[it.ref] = 1;
    out.push(it);
  }
  return out;
}

function extractVideosArray(html) {
  // var videos = [["MEGA","https://...",0],["YourUpload","https://...",0],["Voe","https://...",0]];
  var m = String(html).match(/var\s+videos\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) return [];
  try {
    // sanitizar un poco para JSON-like
    var raw = m[1]
      .replace(/'/g, '"')
      .replace(/,\s*]/g, ']');
    var arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(function (row) {
      if (!Array.isArray(row) || row.length < 2) return null;
      return { name: String(row[0] || '').trim(), url: String(row[1] || '').trim() };
    }).filter(Boolean);
  } catch (e) {
    // fallback regex
    var out = [], re = /\["([^"]+)","(https?:\/\/[^"]+)"/g, mm;
    while ((mm = re.exec(m[1]))) {
      out.push({ name: mm[1], url: mm[2] });
    }
    return out;
  }
}

// ---------- resolve helpers ----------

async function resolveYourUpload(embedUrl) {
  var html = await fetchText(embedUrl, { timeoutMs: 12000 });
  // jwplayer file: "https://...mp4"
  var m = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
  if (m) return { url: m[1], mime: 'video/mp4', label: 'YourUpload' };
  m = html.match(/["'](https?:\/\/[^"']*vidcache\.net[^"']+\.mp4[^"']*)["']/i);
  if (m) return { url: m[1], mime: 'video/mp4', label: 'YourUpload' };
  m = html.match(/sources?\s*:\s*\[\s*\{[^}]*file\s*:\s*["'](https?:\/\/[^"']+)["']/i);
  if (m) return { url: m[1], mime: m[1].indexOf('.m3u8') >= 0 ? 'application/x-mpegURL' : 'video/mp4', label: 'YourUpload' };
  return null;
}

async function resolveVoe(embedUrl) {
  try {
    var html = await fetchText(embedUrl, { timeoutMs: 12000 });
    // posible redirección JS de dominio
    var redir = html.match(/window\.location\.href\s*=\s*['"](https?:\/\/[^'"]+)['"]/);
    if (redir) {
      html = await fetchText(redir[1], { timeoutMs: 10000 });
    }
    // m3u8 o source
    var m = html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
    if (m) return { url: m[1], mime: 'application/x-mpegURL', label: 'Voe' };
    m = html.match(/sources?\s*:\s*\[\s*\{[^}]*src\s*:\s*["'](https?:\/\/[^"']+)["']/i);
    if (m) return { url: m[1], mime: m[1].indexOf('.m3u8') >= 0 ? 'application/x-mpegURL' : 'video/mp4', label: 'Voe' };
    m = html.match(/prompt\s*\(\s*["'](https?:\/\/[^"']+)["']/i);
    if (m) return { url: m[1], mime: 'application/x-mpegURL', label: 'Voe' };
    // base64 packed a veces
    m = html.match(/atob\s*\(\s*["']([A-Za-z0-9+/=]{20,})["']\s*\)/);
    if (m) {
      try {
        var dec = atob(m[1]);
        var um = dec.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
        if (um) return { url: um[0], mime: 'application/x-mpegURL', label: 'Voe' };
      } catch (e) {}
    }
  } catch (e) {}
  return null;
}

function serverKey(name) {
  var n = String(name || '').toLowerCase();
  if (n.indexOf('yourupload') >= 0 || n.indexOf('your upload') >= 0) return 'yourupload';
  if (n.indexOf('voe') >= 0) return 'voe';
  if (n.indexOf('mega') >= 0) return 'mega';
  return n;
}

// ---------- exports ----------

export async function home() {
  var html = await fetchText(BASE + '/');
  var rows = [];

  // Últimos Episodios (movie items for quick play)
  var epItems = parseEpisodeCards(html).slice(0, 48);
  if (epItems.length) {
    rows.push({
      id: 'r~ultimos-ep',
      title: 'Últimos Episodios',
      items: epItems,
      ref: 'B|ultimos-ep'
    });
  }

  // Últimos Hentai (series)
  var seriesItems = parseSeriesCards(html).slice(0, 48);
  if (seriesItems.length) {
    rows.push({
      id: 'r~ultimos-hentai',
      title: 'Últimos Hentai',
      items: seriesItems,
      ref: 'B|directorio'
    });
  }

  // Hentai Sin Censura
  try {
    var scHtml = await fetchText(BASE + '/directorio?censura=no');
    var scItems = parseSeriesCards(scHtml).slice(0, 48);
    if (scItems.length) {
      rows.push({
        id: 'r~sin-censura',
        title: 'Hentai Sin Censura',
        items: scItems,
        ref: 'B|censura=no'
      });
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
  var url = BASE + '/directorio?q=' + encodeURIComponent(q);
  if (page > 1) url += '&p=' + page;
  var html = await fetchText(url);
  var items = parseSeriesCards(html);
  // también episodios si aparecen
  var eps = parseEpisodeCards(html);
  items = dedupe(items.concat(eps));
  var next = null;
  if (items.length >= 12 && /[?&]p=\d+|page=\d+|Siguiente|Next/i.test(html)) {
    next = 'p=' + (page + 1);
  }
  return { items: items.slice(0, 60), next: next };
}

export async function browse(ref, cursor) {
  var page = 1;
  if (cursor) {
    var cm = String(cursor).match(/p=(\d+)/);
    if (cm) page = parseInt(cm[1], 10) || 1;
  }
  var path = 'directorio';
  var r = String(ref || '');
  if (r.indexOf('B|') === 0) r = r.slice(2);
  if (r === 'ultimos-ep') {
    // re-usar home episodes, sin paginación real
    var h = await fetchText(BASE + '/');
    return { items: parseEpisodeCards(h).slice(0, 60) };
  }
  if (r === 'censura=no' || r.indexOf('censura') >= 0) {
    path = 'directorio?censura=no';
  } else if (r === 'directorio' || r === 'ultimos-hentai') {
    path = 'directorio';
  } else if (r.charAt(0) === '/') {
    path = r.replace(/^\//, '');
  }
  var url = BASE + '/' + path;
  if (page > 1) {
    url += (url.indexOf('?') >= 0 ? '&' : '?') + 'p=' + page;
  }
  var html = await fetchText(url);
  var items = parseSeriesCards(html);
  if (!items.length) items = parseEpisodeCards(html);
  var next = null;
  if (items.length >= 12) next = 'p=' + (page + 1);
  return { items: items.slice(0, 60), next: next };
}

export async function episodes(ref) {
  var r = String(ref || '');
  if (r.indexOf('S|') === 0) r = r.slice(2);
  else if (r.indexOf('E|') === 0) {
    // single episode treated as movie — no episodes list
    return { episodes: [] };
  }
  var slug = r.replace(/^\/?hentai\//, '').replace(/\/$/, '');
  var html = await fetchText(BASE + '/hentai/' + encodeURIComponent(slug));
  var title = '';
  var tm = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (tm) title = stripTags(tm[1]);
  var poster;
  var pm = html.match(/uploads\/portadas\/[^"'\s]+/i);
  if (pm) poster = abs('/' + pm[0]);
  var overview = '';
  var om = html.match(/<p[^>]*class=["'][^"']*sinopsis[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)
    || html.match(/<div[^>]*class=["'][^"']*(?:sinopsis|description|overview)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (om) overview = stripTags(om[1]).slice(0, 600);

  var eps = [];
  var re = /<a\s+href=["'](\/ver\/([^"'?#]+))["'][^>]*>[\s\S]*?(?:Episodio|Episode|Cap[ií]tulo)?\s*(\d+)/gi;
  var m, seen = {};
  while ((m = re.exec(html))) {
    var eslug = m[2];
    var num = parseInt(m[3], 10);
    if (!eslug || !(num > 0) || seen[eslug]) continue;
    seen[eslug] = 1;
    eps.push({
      season: 1,
      number: num,
      ref: 'E|' + eslug,
      title: (title ? title + ' ' : '') + 'Ep. ' + num
    });
  }
  // ordenar por número ascendente
  eps.sort(function (a, b) { return a.number - b.number; });

  // si no encontró con el patrón, buscar todos los /ver/ del listado
  if (!eps.length) {
    re = /href=["']\/ver\/([^"'?#]+)["']/gi;
    var nums = {};
    while ((m = re.exec(html))) {
      var es = m[1];
      var nm = es.match(/-(\d+)$/);
      var n = nm ? parseInt(nm[1], 10) : 0;
      if (n > 0 && !nums[es]) {
        nums[es] = n;
        eps.push({
          season: 1,
          number: n,
          ref: 'E|' + es,
          title: (title ? title + ' ' : '') + 'Ep. ' + n
        });
      }
    }
    eps.sort(function (a, b) { return a.number - b.number; });
  }

  return {
    series: {
      title: title || slug,
      poster: poster,
      overview: overview || undefined
    },
    episodes: eps
  };
}

export async function resolve(ref) {
  var r = String(ref || '');
  if (r.indexOf('E|') === 0) r = r.slice(2);
  else if (r.indexOf('S|') === 0) {
    throw kino.error('resolve', 'Este ítem es una serie; abre un episodio.');
  }
  var slug = r.replace(/^\/?ver\//, '').replace(/\/$/, '');
  var pageUrl = BASE + '/ver/' + encodeURIComponent(slug);
  var html = await fetchText(pageUrl);

  var servers = extractVideosArray(html);
  if (!servers.length) {
    // fallback: buscar embeds directos
    var megaM = html.match(/https?:\/\/mega\.nz\/(?:embed\/|#!|file\/)[^\s"'<>]+/i);
    var yuM = html.match(/https?:\/\/(?:www\.)?yourupload\.com\/embed\/[A-Za-z0-9]+/i);
    var voeM = html.match(/https?:\/\/(?:[a-z0-9-]+\.)?voe\.sx\/e\/[A-Za-z0-9]+/i);
    if (yuM) servers.push({ name: 'YourUpload', url: yuM[0] });
    if (voeM) servers.push({ name: 'Voe', url: voeM[0] });
    if (megaM) servers.push({ name: 'MEGA', url: megaM[0] });
  }

  // ordenar por prioridad
  servers.sort(function (a, b) {
    var ka = PRIO.indexOf(serverKey(a.name));
    var kb = PRIO.indexOf(serverKey(b.name));
    if (ka < 0) ka = 99;
    if (kb < 0) kb = 99;
    return ka - kb;
  });

  var primary = null;
  var alternatives = [];

  for (var i = 0; i < servers.length; i++) {
    var s = servers[i];
    var key = serverKey(s.name);
    var stream = null;
    try {
      if (key === 'yourupload') {
        stream = await resolveYourUpload(s.url);
      } else if (key === 'voe') {
        stream = await resolveVoe(s.url);
      } else if (key === 'mega') {
        // Mega embed no da MP4/HLS fácil; dejar como alternativa etiquetada
        stream = { url: s.url, label: 'MEGA (embed)', mime: 'text/html' };
      }
    } catch (e) {
      // siguiente
    }
    if (!stream || !stream.url) continue;
    // evitar anuncios obvios
    if (/malosas|stripchat|adsco|whitetrafsa|creative\./i.test(stream.url)) continue;
    if (!primary) {
      primary = stream;
    } else {
      alternatives.push({
        url: stream.url,
        mime: stream.mime,
        label: stream.label || s.name
      });
    }
  }

  if (!primary) {
    throw kino.error('resolve', 'No se encontró un stream reproducible (YourUpload/Voe). Prueba más tarde.');
  }

  var out = {
    url: primary.url,
    mime: primary.mime || (primary.url.indexOf('.m3u8') >= 0 ? 'application/x-mpegURL' : 'video/mp4'),
    label: primary.label || 'YourUpload'
  };
  if (alternatives.length) out.alternatives = alternatives.slice(0, 6);
  // headers útiles para vidcache / algunos hosts
  if (/vidcache\.net/i.test(out.url)) {
    out.headers = {
      'User-Agent': BROWSER_UA,
      'Referer': 'https://www.yourupload.com/'
    };
  }
  return out;
}
