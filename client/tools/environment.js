import { loadEnvironment } from "../../shared/environment.js";

// Host tools only. Browser builds use explicit define values, never this object.
export const clientEnvironment = loadEnvironment("client");
