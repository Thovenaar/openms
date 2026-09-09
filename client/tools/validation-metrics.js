/** Distribution summaries allocate only after a measurement ends. */
export function statistics(samples) {
  if (samples.length > 50000 || !samples.every(Number.isFinite)) {
    throw new Error("Invalid measurement samples");
  }
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
  if (window.__mapleProbe) return;
  const probe = {
    intervals: new Float64Array(50000),
    count: 0,
    overflow: 0,
    last: 0,
    started: performance.now(),
    longTasks: [],
    longTaskOverflow: 0,
    frameHandle: 0,
  };
  window.__mapleProbe = probe;
  function frame(now) {
    if (probe.last) {
      if (probe.count < probe.intervals.length) {
        probe.intervals[probe.count++] = now - probe.last;
      } else probe.overflow++;
    }
    probe.last = now;
    probe.frameHandle = requestAnimationFrame(frame);
  }
  probe.frameHandle = requestAnimationFrame(frame);
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.startTime < probe.started) continue;
      if (probe.longTasks.length < 512) {
        probe.longTasks.push({
          start: entry.startTime,
          duration: entry.duration,
        });
      } else probe.longTaskOverflow++;
    }
  });
  observer.observe({ type: "longtask", buffered: true });
  function stop() {
    cancelAnimationFrame(probe.frameHandle);
    observer.disconnect();
    delete window.__mapleProbe;
  }
  window.addEventListener("pagehide", stop, { once: true });
}

/** @param {import('puppeteer-core').Page} page */
export async function resetProbe(page) {
  await page.evaluate(() => {
    const probe = window.__mapleProbe;
    probe.count = 0;
    probe.overflow = 0;
    probe.last = 0;
    probe.started = performance.now();
    probe.runtimeStartFrames = window.maple?.snapshot().metrics.frames ?? null;
    probe.longTasks.length = 0;
    probe.longTaskOverflow = 0;
  });
}

/** @param {import('puppeteer-core').Page} page */
export async function measureProbe(page) {
  const observation = await page.evaluate(() => {
    const probe = window.__mapleProbe;
    const metrics = window.maple?.snapshot().metrics;
    const count =
      metrics &&
      probe.runtimeStartFrames !== null &&
      probe.runtimeStartFrames !== undefined
        ? Math.min(
            metrics.frameCpuMs.length,
            metrics.frames - probe.runtimeStartFrames,
          )
        : 0;
    const frameCpuMs = [],
      drawCpuMs = [];
    for (let offset = count - 1; offset >= 0; offset--) {
      const index =
        (metrics.sampleIndex - offset + metrics.frameCpuMs.length) %
        metrics.frameCpuMs.length;
      frameCpuMs.push(metrics.frameCpuMs[index]);
      drawCpuMs.push(metrics.drawCpuMs[index]);
    }
    return {
      durationMs: performance.now() - probe.started,
      intervals: Array.from(probe.intervals.subarray(0, probe.count)),
      overflow: probe.overflow,
      longTasks: probe.longTasks,
      longTaskOverflow: probe.longTaskOverflow,
      runtimeCPU: {
        scope:
          "Trailing runtime metric ring within this window; milliseconds, not whole-run coverage",
        totalFrames:
          metrics &&
          probe.runtimeStartFrames !== null &&
          probe.runtimeStartFrames !== undefined
            ? metrics.frames - probe.runtimeStartFrames
            : null,
        frameCpuMs,
        drawCpuMs,
      },
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
  observation.runtimeCPU.frame = statistics(observation.runtimeCPU.frameCpuMs);
  observation.runtimeCPU.draw = statistics(observation.runtimeCPU.drawCpuMs);
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
