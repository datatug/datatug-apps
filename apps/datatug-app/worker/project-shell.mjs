// The app's Worker, run only for `/project/*` (wrangler.jsonc `assets.run_worker_first`).
//
// Workers Assets answers a path that is not a file with a 307 to a normalised path, and that normalisation decodes
// `%2F` into a real `/` (measured with `wrangler dev`, 2026-10-23): `/project/github.com/o/r@feature%2Fx/d` became
// `/project/github.com/o/r%40feature/x/d`, which the app reads as ref `feature` and folder `x/d`. A project address
// keeps its `%2F` (a ref such as `feature/x`, a folder-qualified query id) only if the SPA shell is served for the
// address exactly as typed. So for a page load under `/project/` this Worker returns the shell (the response of `/`)
// with no redirect, and leaves every other request to the assets as before.

/** Whether the request is a page load the SPA shell answers. */
function isShellRequest(request) {
  return request.method === 'GET' || request.method === 'HEAD';
}

export default {
  /**
   * @param {Request} request
   * @param {{ ASSETS: { fetch(request: Request): Promise<Response> } }} env
   */
  async fetch(request, env) {
    if (!isShellRequest(request)) {
      return env.ASSETS.fetch(request);
    }
    const shell = new URL('/', request.url);
    return env.ASSETS.fetch(new Request(shell, request));
  },
};
