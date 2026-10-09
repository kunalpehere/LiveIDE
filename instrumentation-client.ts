import { reportClientError } from "./lib/client-monitoring";

window.addEventListener("error", event => { reportClientError("browser.error", event.error); });
window.addEventListener("unhandledrejection", event => { reportClientError("browser.rejection", event.reason); });
