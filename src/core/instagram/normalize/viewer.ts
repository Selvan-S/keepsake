/**
 * Working out whether a session is live, from the page Instagram serves.
 *
 * The obvious approach — asking a JSON endpoint who we are — does not work:
 * `/api/v1/users/{id}/info/` on www.instagram.com answers with the app shell as
 * `text/html`, and `/api/v1/accounts/current_user/` answers 400. What does work
 * is that a logged-in homepage embeds the viewer's own profile object, so the
 * account id we hold appears next to the username it belongs to.
 *
 * Parsing HTML with regular expressions is not something to be proud of, and it
 * is used deliberately narrowly: this decides "is this session alive and whose
 * is it", never what gets archived. If the markup shifts, the worst case is a
 * session reported as unverifiable, not wrong data in an archive.
 */

/** How far from the id a username may sit and still be that user's. */
const NEAR = 3000;

const USERNAME = /"username":"([A-Za-z0-9._]{1,30})"/g;

/** Markers that only appear when Instagram is asking for a login. */
const LOGGED_OUT_MARKERS = [
  '"LoginAndSignupPage"',
  'action="/accounts/login',
  '"login_form"',
  '"is_logged_in":false',
];

export type ViewerCheck = {
  /** Instagram is treating this session as signed in. */
  loggedIn: boolean;
  /** The account's handle, when it could be read. May be empty even when signed in. */
  username: string;
  /**
   * Instagram is asking for a login. Distinct from merely not finding the id:
   * "your cookies were refused" and "we could not tell" need different advice.
   */
  sawLoginPage: boolean;
};

/**
 * Read the signed-in viewer out of an instagram.com page.
 *
 * The id is the anchor rather than the username: a homepage is full of other
 * people's usernames, and the only one that means anything is the one sitting
 * beside the account id we authenticated as.
 */
export function viewerFromHtml(html: string, dsUserId: string): ViewerCheck {
  const sawLoginPage = LOGGED_OUT_MARKERS.some((marker) => html.includes(marker));
  if (!html || !dsUserId) return { loggedIn: false, username: "", sawLoginPage };

  const anchor = `"id":"${dsUserId}"`;
  let best = { distance: Number.POSITIVE_INFINITY, username: "" };
  let found = false;

  for (let at = html.indexOf(anchor); at !== -1; at = html.indexOf(anchor, at + 1)) {
    found = true;
    // Forward only. The page is full of other people's usernames, and one of
    // them sitting just *before* our id would otherwise win on distance.
    // Instagram serialises these objects with their keys in alphabetical
    // order, so "username" reliably follows "id" within the same object.
    const window = html.slice(at + anchor.length, at + anchor.length + NEAR);
    USERNAME.lastIndex = 0;
    const m = USERNAME.exec(window);
    if (m && m.index < best.distance) best = { distance: m.index, username: m[1]! };
  }

  // The id appearing at all is the signal: Instagram does not echo an account
  // id back to a request it refused.
  if (found) return { loggedIn: true, username: best.username, sawLoginPage };

  return { loggedIn: false, username: "", sawLoginPage };
}
