# Sign-in domain (Firebase `authDomain`)

Sign-in with Google, GitHub or Microsoft runs through Firebase Auth's helper pages, `/__/auth/handler` and
`/__/auth/iframe`, on the app's `authDomain`.

| `authDomain`                      | Where the helper pages come from                                                                                                                         | Result                                                                                                                                                                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth.sneat.co` (today's default) | Firebase Hosting                                                                                                                                         | A different site from `datatug.app`. Browsers partition the iframe storage that carries the sign-in result back, so the opener tab never gets it ("Cross-Origin-Opener-Policy policy would block the window.closed call"), and the popup ends up showing the app itself. |
| `datatug.app`                     | Cloudflare proxies `datatug.app/__/*` to Firebase (`sneat-co/sneat-sites`, `infra/firebase-auth-proxy`, already deployed and enrolled for `datatug.app`) | First-party, which is Firebase's documented fix.                                                                                                                                                                                                                         |

The app serves no `Cross-Origin-Opener-Policy` header (`scripts/wrangler-routes.test.mjs` guards that).

## The switch

`apps/datatug-app/src/environments/auth-domain.ts` picks the domain. `DATATUG_SAME_ORIGIN_AUTH_BY_DEFAULT` in
`environment.prod.ts` is the deployed default and is **`false`** until the steps below are done, because with it on and
the steps undone, every sign-in fails. Hosts other than `datatug.app` (`app.incidentius.com`, previews) always keep
`auth.sneat.co`.

Try it in one browser before flipping the default: open `https://datatug.app/login?authDomain=same-origin`. The choice
is kept in `localStorage`. `?authDomain=shared` forces the old domain and `?authDomain=default` forgets the choice.

## Founder steps (nothing here is done by code)

1. **Release `datatug.app` from its old Firebase Hosting project.** Identity Toolkit answers
   `createAuthUri` for `https://datatug.app/__/auth/handler` with `INVALID_CONTINUE_URI: The continue_uri domain
belongs to a different Firebase Hosting project`. It is not a custom domain of any `sneat-eur3-1` Hosting site, so
   an old project still holds it (datatug.app was once deployed with `firebase deploy --only hosting:datatug`). In the
   Firebase console, open each old project, Hosting, Custom domains, and remove `datatug.app`. Re-check with:
   ```sh
   curl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=<web API key of sneat-eur3-1>" \
     -H 'Content-Type: application/json' \
     -d '{"providerId":"google.com","continueUri":"https://datatug.app/__/auth/handler"}'
   ```
   It must return an `authUri`, not an error.
2. **Firebase console, project `sneat-eur3-1`, Authentication, Settings, Authorized domains:** add `datatug.app` if it is
   missing.
3. **Google Cloud console, project `sneat-eur3-1`, APIs & Services, Credentials, the Web client Firebase uses for Google
   sign-in** (client ID `588648831063-85a4mor5tivua7jj5qj79q4ussjh8qe5`): add `https://datatug.app/__/auth/handler` to
   Authorized redirect URIs.
4. **GitHub OAuth app that Firebase's GitHub provider uses** (Firebase console, Authentication, Sign-in method, GitHub,
   shows the client ID and the callback URL to register): GitHub accepts a single callback host per OAuth app, so
   adding `https://datatug.app/__/auth/handler` means replacing `https://auth.sneat.co/__/auth/handler`, which breaks
   GitHub sign-in for every other Sneat product on the shared domain. Either use a GitHub App (it allows several
   callback URLs) for this provider, or do this step only when all products have moved to their own domains.
5. **Microsoft (Entra ID app registration used by Firebase's Microsoft provider):** add the redirect URI
   `https://datatug.app/__/auth/handler` (Web platform).
6. Test with `https://datatug.app/login?authDomain=same-origin` (Google first), then land a pull request that sets
   `DATATUG_SAME_ORIGIN_AUTH_BY_DEFAULT = true`.

## The `/space/...` address after sign-in

The shared login page sends a signed-in user to their saved Sneat space (`/space/<type>/<id>`). DataTug has no such page,
so `datatug-app-routes.ts` redirects exactly that address to the root, and the product profile sends it on to its home.
`src/app/login-continue.spec.ts` renders the real login page and clicks Continue.
