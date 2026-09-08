/** Distribution summaries allocate only after a measurement ends. */
export function statistics(samples) {
  if (!samples.length) {
    return {
      samples: 0,
      mean: null,
      p50: null,
      p95: null,
      p99: null,
      max: null,
    };
  }
  const ordered = [...samples].sort((left, right) => left - right);
  const percentile = (fraction) =>
    ordered[Math.ceil(fraction * ordered.length) - 1];
  return {
    samples: ordered.length,
    mean: samples.reduce((sum, sample) => sum + sample, 0) / ordered.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    min: ordered[0],
    max: ordered.at(-1),
    over20ms: samples.filter((sample) => sample > 20).length,
    over33ms: samples.filter((sample) => sample > 33.34).length,
  };
}

/** Runs in Chrome; fixed storage ensures the probe itself has bounded memory. */
export function installProbe() {
  const probe = {
    intervals: new Float64Array(50000),
    count: 0,
    overflow: 0,
    last: 0,
    started: performance.now(),
    longTasks: [],
    longTaskOverflow: 0,
  };
  window.__mapleProbe = probe;
  function frame(now) {
    if (probe.last) {
      if (probe.count < probe.intervals.length) {
        probe.intervals[probe.count++] = now - probe.last;
      } else probe.overflow++;
    }
    probe.last = now;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (probe.longTasks.length < 512) {
        probe.longTasks.push({
          start: entry.startTime,
          duration: entry.duration,
        });
      } else probe.longTaskOverflow++;
    }
  });
  observer.observe({ type: "longtask", buffered: true });
  window.addEventListener("pagehide", () => observer.disconnect(), {
    once: true,
  });
}

/** @param {import('puppeteer-core').Page} page */
export async function resetProbe(page) {
  await page.evaluate(() => {
    const probe = window.__mapleProbe;
    probe.count = 0;
    probe.overflow = 0;
    probe.last = 0;
    probe.started = performance.now();
    probe.longTasks.length = 0;
    probe.longTaskOverflow = 0;
  });
}

/** @param {import('puppeteer-core').Page} page */
export async function measureProbe(page) {
  const observation = await page.evaluate(() => {
    const probe = window.__mapleProbe;
    return {
      durationMs: performance.now() - probe.started,
      intervals: Array.from(probe.intervals.subarray(0, probe.count)),
      overflow: probe.overflow,
      longTasks: probe.longTasks,
      longTaskOverflow: probe.longTaskOverflow,
      heap: performance.memory
        ? {
            used: performance.memory.usedJSHeapSize,
            total: performance.memory.totalJSHeapSize,
            limit: performance.memory.jsHeapSizeLimit,
          }
        : null,
    };
  });
  const frames = statistics(observation.intervals);
  delete observation.intervals;
  return { ...observation, frames };
}

/** Explicit emulation policy, not a claim about a particular physical network. */
export async function throttleNetwork(page) {
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  const conditions = {
    offline: false,
    latency: 150,
    downloadThroughput: 1500000 / 8,
    uploadThroughput: 750000 / 8,
    connectionType: "cellular3g",
  };
  await cdp.send("Network.emulateNetworkConditions", conditions);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  return { cdp, conditions };
}
