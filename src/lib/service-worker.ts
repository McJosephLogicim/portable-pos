import { cashPhotos } from "./cash";
import { appIcons, emptyStateObjects, popoLoading, popoPoses } from "./app-brand";

let preparing: Promise<boolean> | undefined;

async function prepare(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return false;
  await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  // Browsers decide whether this install qualifies for storage protected from eviction.
  void navigator.storage?.persist?.().catch(() => false);
  const registration = await navigator.serviceWorker.ready;
  const worker = registration.active;
  if (!worker) return false;
  const resources = [
    ...Object.values(appIcons),
    ...Object.values(popoPoses),
    ...Object.values(emptyStateObjects),
    popoLoading.poster,
    ...(!matchMedia("(prefers-reduced-motion: reduce)").matches ? [popoLoading.wave] : []),
    "/manifest.webmanifest",
    ...cashPhotos,
    ...performance.getEntriesByType("resource").map((entry) => entry.name),
    ...Array.from(document.images, (img) => img.currentSrc || img.src).filter(
      Boolean,
    ),
  ];
  return new Promise<boolean>((resolve) => {
    const channel = new MessageChannel();
    function finish(ready: boolean) {
      clearTimeout(timer);
      channel.port1.close();
      resolve(ready);
    }
    const timer = setTimeout(() => finish(false), 30000);
    channel.port1.onmessage = (event) => finish(event.data?.ready === true);
    worker.postMessage({ type: "PREPARE_REGISTER", resources }, [
      channel.port2,
    ]);
  });
}

export function prepareOffline(): Promise<boolean> {
  if (!preparing) {
    preparing = prepare()
      .catch(() => false)
      .finally(() => {
        preparing = undefined;
      });
  }
  return preparing;
}
