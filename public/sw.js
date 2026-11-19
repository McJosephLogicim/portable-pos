// Cache only public app resources. Signed-in register data belongs in IndexedDB.
const ASSETS = "portable-pos-static-v1";
const SHELL = "portable-pos-shell-v1";
const ROOT = new URL("/", self.location.origin).href;

self.addEventListener("install", (event) =>
  event.waitUntil(self.skipWaiting()),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

function assetURL(input, base = ROOT) {
  const url = new URL(input, base);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) return url.href;
  // Uploaded photos never change under the same id.
  if (/^\/api\/images\/[0-9a-f-]{36}$/.test(url.pathname)) return url.href;
  if (url.pathname.startsWith("/api/")) return;
  if (
    url.pathname.startsWith("/menu/") &&
    /\.(png|jpe?g|webp|svg|avif)$/i.test(url.pathname)
  )
    return url.href;
  if (
    [
      "/icon-192.png",
      "/icon-512.png",
      "/apple-touch-icon.png",
      "/favicon.ico",
    ].includes(url.pathname)
  )
    return url.href;
  if (url.pathname === "/manifest.webmanifest") return url.href;
}

async function storeAsset(cache, url, visited) {
  if (visited.has(url)) return;
  visited.add(url);
  const immutable = new URL(url).pathname.startsWith("/_next/static/");
  const existing = immutable && (await cache.match(url));
  const response =
    existing ||
    (await fetch(url, { credentials: "same-origin", cache: "reload" }));
  if (
    !response.ok ||
    response.redirected ||
    response.headers.get("content-type")?.includes("text/html")
  ) {
    throw new Error("A register resource could not be saved.");
  }
  if (/\.css(?:\?|$)/.test(url)) {
    const css = await response.clone().text();
    const urls = [...css.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)]
      .map((match) => assetURL(match[1], url))
      .filter(Boolean);
    await Promise.all(urls.map((item) => storeAsset(cache, item, visited)));
  }
  if (!existing) await cache.put(url, response);
}

async function warm(resources) {
  const response = await fetch(ROOT, {
    cache: "reload",
    credentials: "same-origin",
    headers: { Accept: "text/html" },
  });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("text/html")
  ) {
    throw new Error("Register shell unavailable.");
  }
  const html = await response.clone().text();
  const urls = new Set();
  const extras = new Set(resources.map((url) => assetURL(url)).filter(Boolean));
  // Include the new deployment's bootstrap chunks if the app changed since this tab loaded.
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
    const resource = assetURL(match[1].replace(/&amp;/g, "&"));
    if (!resource) continue;
    if (
      new URL(resource).pathname.startsWith("/_next/static/") &&
      /\.(js|css)(?:$|\?)/.test(resource)
    )
      urls.add(resource);
    else extras.add(resource);
  }
  if (
    ![...urls].some(
      (url) => url.includes("/_next/static/") && url.includes(".js"),
    )
  ) {
    throw new Error("The register shell is incomplete.");
  }
  const cache = await caches.open(ASSETS);
  const visited = new Set();
  await Promise.all([...urls].map((url) => storeAsset(cache, url, visited)));
  // Optional images and obsolete assets from an older open tab must not block a sale.
  await Promise.allSettled(
    [...extras].map((url) => storeAsset(cache, url, visited)),
  );
  // Replacing the cached HTML last keeps the previous shell usable on a partial update.
  await (await caches.open(SHELL)).put(ROOT, response);
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== "PREPARE_REGISTER" || !event.ports[0]) return;
  const port = event.ports[0];
  event.waitUntil(
    (async () => {
      try {
        await warm(event.data.resources);
        port.postMessage({ ready: true });
      } catch {
        const fallback = await (await caches.open(SHELL)).match(ROOT);
        port.postMessage({ ready: Boolean(fallback) });
      }
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && url.pathname === "/") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.status < 500) return response;
          return (await caches.match(ROOT, { cacheName: SHELL })) || response;
        } catch {
          return (
            (await caches.match(ROOT, { cacheName: SHELL })) || Response.error()
          );
        }
      })(),
    );
    return;
  }
  if (!assetURL(url)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(ASSETS);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (
        response.ok &&
        !response.redirected &&
        !response.headers.get("content-type")?.includes("text/html")
      ) {
        await cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })(),
  );
});
