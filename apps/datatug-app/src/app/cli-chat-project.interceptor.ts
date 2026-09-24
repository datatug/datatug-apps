import { HttpInterceptorFn } from '@angular/common/http';
import { cliChatCapability } from './cli-chat-capability';

// The existing project menu reads its summary through HttpClient. Limit the
// bridge capability to that one request on the exact loopback host in the link.
export const cliChatProjectInterceptor: HttpInterceptorFn = (request, next) => {
  const fragment = new URLSearchParams(cliChatCapability());
  const host = fragment.get('h');
  const token = fragment.get('t');
  if (!host || !/^127\.0\.0\.1:\d{1,5}$/.test(host) || !token || !/^[a-f0-9]{64}$/.test(token)) {
    return next(request);
  }
  const url = new URL(request.url, location.origin);
  if (url.origin !== `http://${host}` || url.pathname !== '/datatug/projects/project_summary') {
    return next(request);
  }
  return next(request.clone({ setHeaders: { 'X-DataTug-Chat-Capability': token } }));
};
