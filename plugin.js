const BASE = "https://seriesbiblicas.net";
const API = BASE + "/wp-json/wp/v2/posts?per_page=50";

function decodeHtml(html) {
  return html.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
             .replace(/&quot;/g, '"')
             .replace(/&apos;/g, "'")
             .replace(/&amp;/g, '&')
             .replace(/&ldquo;|&rdquo;/g, '"')
             .replace(/&lsquo;|&rsquo;/g, "'");
}

function cleanHtml(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function extractImageUrl(content) {
  const match = content.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function extractEpisodes(content) {
  const match = content.match(/data-episodes=["'](\[[^\]]+\])["']/);
  if (match) {
    try {
      const jsonStr = match[1]
        .replace(/&quot;/g, '"')
        .replace(/\\u00ed/g, 'í').replace(/\\u00e1/g, 'á')
        .replace(/\\u00f3/g, 'ó').replace(/\\u00fa/g, 'ú')
        .replace(/\\u00f1/g, 'ñ').replace(/\\u00e9/g, 'é');
      return JSON.parse(jsonStr);
    } catch (e) {
      return [];
    }
  }
  return [];
}

function mapPost(p) {
  const img = extractImageUrl(p.content.rendered) || extractImageUrl(p.excerpt.rendered);
  return {
    id: String(p.id),
    ref: String(p.id),
    title: decodeHtml(p.title.rendered),
    kind: "movie",
    poster: img ? (img.startsWith("http") ? img : BASE + img) : undefined,
    overview: cleanHtml(p.excerpt.rendered).slice(0, 300) || undefined
  };
}

export async function home() {
  const r = await kino.fetch(API);
  if (!r.ok) throw new Error("No se pudo cargar el inicio");
  const posts = await r.json();
  return [{
    id: "latest",
    title: "Últimos Agregados",
    ref: "latest",
    items: posts.map(mapPost)
  }];
}

export async function search(query) {
  const url = BASE + "/wp-json/wp/v2/posts?search=" + encodeURIComponent(query) + "&per_page=50";
  const r = await kino.fetch(url);
  if (!r.ok) throw new Error("Búsqueda fallida");
  const posts = await r.json();
  return posts.map(mapPost);
}

export async function browse(ref, cursor) {
  const page = cursor ? Number(cursor) : 1;
  const url = API + "&page=" + page;
  const r = await kino.fetch(url);
  if (!r.ok) throw new Error("No se pudo cargar la página");
  const posts = await r.json();
  const next = posts.length === 50 ? String(page + 1) : undefined;
  return { items: posts.map(mapPost), next };
}

export async function episodes(ref) {
  const r = await kino.fetch(BASE + "/wp-json/wp/v2/posts/" + ref);
  if (!r.ok) throw new Error("No se pudo cargar el detalle");
  const post = await r.json();
  const eps = extractEpisodes(post.content.rendered);
  const img = extractImageUrl(post.content.rendered);
  
  return {
    series: {
      title: decodeHtml(post.title.rendered),
      poster: img ? (img.startsWith("http") ? img : BASE + img) : undefined
    },
    episodes: eps.map((ep, i) => ({
      season: 1,
      number: ep.number || (i + 1),
      ref: ep.embed || ("okru:" + (ep.embed ? ep.embed.split('/').pop() : "")),
      title: decodeHtml(ep.title || "Episodio " + (ep.number || (i + 1)))
    }))
  };
}

export async function resolve(ref) {
  let okUrl = ref;
  if (ref.startsWith("okru:")) {
    okUrl = "https://ok.ru/video/" + ref.substring(5);
  } else if (ref.includes("ok.ru/videoembed/")) {
    okUrl = ref.replace("videoembed", "video");
  }

  const headers = { 
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://ok.ru/"
  };

  try {
    const r = await kino.fetch(okUrl, { headers });
    const html = await r.text();
    
    const match = html.match(/data-options=["']([^"']+)["']/);
    if (match) {
      const optsStr = match[1].replace(/&quot;/g, '"');
      const opts = JSON.parse(optsStr);
      if (opts.flashvars && opts.flashvars.metadata) {
        const meta = JSON.parse(opts.flashvars.metadata);
        if (meta.videos && meta.videos.length > 0) {
          const qualityOrder = { "ultra": 5, "quad": 4, "full": 3, "hd": 2, "sd": 1, "low": 0, "lowest": -1 };
          meta.videos.sort((a, b) => (qualityOrder[b.name] || 0) - (qualityOrder[a.name] || 0));
          
          return {
            url: meta.videos[0].url,
            mime: "video/mp4",
            headers: headers
          };
        }
      }
    }
  } catch (e) {
    // Si falla la extracción, se usa el fallback
  }

  // Fallback: devuelve la URL de OK.ru directamente (algunos reproductores la manejan)
  return {
    url: okUrl,
    headers: headers
  };
}
