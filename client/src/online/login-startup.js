/**
 * Required login-page resource preparation: the catalog, the shared UI bundles and
 * the login artwork. The browser entry owns the actual sequence; splitting the
 * outcome here keeps its failure contract testable without a DOM.
 *
 * A required-asset failure hands the visible surface to the loading presentation
 * and resolves `false`, so the caller stops before publishing a login page without
 * its art. Cancellation is an ordinary rejected promise for the shutdown path.
 */
export async function prepareLoginStartup({ prepare, loading, onFailure }) {
  try {
    await prepare();
    return true;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    // Take the visible surface first: teardown or reporting failures must not
    // leave the player on a login page whose art never loaded.
    loading.failStartup();
    onFailure(error);
    return false;
  }
}
