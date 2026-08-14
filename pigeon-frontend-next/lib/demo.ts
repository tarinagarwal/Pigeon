/** postMessage type sent from landing iframe overlay to start the product tour */
export const IFRAME_START_TOUR_MESSAGE = "pigeon-iframe-start-tour";

/** postMessage type sent from dashboard iframe when demo tour is done; parent should navigate to signup */
export const IFRAME_TOUR_DONE_MESSAGE = "pigeon-iframe-tour-done";

/** postMessage from iframe to parent: current path (so parent can enforce dashboard for initial period) */
export const IFRAME_PATH_MESSAGE = "pigeon-iframe-path";

/** postMessage from parent to iframe: navigate back to dashboard (e.g. during initial 5s lock) */
export const IFRAME_GOTO_DASHBOARD_MESSAGE = "pigeon-iframe-goto-dashboard";
