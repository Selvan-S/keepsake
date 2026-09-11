/** The public web client id. Rarely changes; see PLAN.md. */
export const IG_APP_ID = "936619743392459";

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.94 Mobile Safari/537.36";

/**
 * Items per timeline page. A search is usually someone checking one profile, so
 * the first screen is all that is needed; asking for a big page every time is
 * volume Instagram can weigh against the account for no benefit.
 */
export const PREVIEW_COUNT = 12;
