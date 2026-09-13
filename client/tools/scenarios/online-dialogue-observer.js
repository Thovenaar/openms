/** Observe server dialogue generations over CDP; this helper never sends gameplay messages. */
export async function observeDialogue(page) {
  const wire = await page.createCDPSession();
  await wire.send("Network.enable");
  const observed = { event: null, change: Promise.withResolvers() };
  wire.on("Network.webSocketFrameReceived", ({ response }) => {
    const event = JSON.parse(response.payloadData).event;
    if (event?.kind !== "dialogue" && event?.kind !== "dialogue.closed") return;
    observed.event = event.kind === "dialogue" ? event : null;
    const previous = observed.change;
    observed.change = Promise.withResolvers();
    previous.resolve();
  });
  return observed;
}

export async function waitForDialogue(observed, predicate) {
  for (let event = 0; event < 32; event++) {
    if (predicate(observed.event)) return observed.event;
    let timer;
    try {
      await Promise.race([
        observed.change.promise,
        new Promise((resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error("Expected server dialogue generation did not arrive"),
              ),
            15000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Dialogue observation exceeded32 events");
}
