// Single place to point the extension at its backend.
// Change this to your deployed Worker URL for production builds.
export const BACKEND_URL = "https://recipeclip-backend.nanavatidevam.workers.dev";

/** On-demand endpoints called directly from the side panel. */
export const SHOP_URL = `${BACKEND_URL}/shop`;
export const SUBSTITUTE_URL = `${BACKEND_URL}/substitute`;
