import { startGameTab } from "../game-tab.js";
import { initializeProjectBar } from "../project-bar.js";

initializeProjectBar();
startGameTab(() => import("../../online/main.js"));
