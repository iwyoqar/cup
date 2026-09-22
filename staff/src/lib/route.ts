import { useEffect, useState } from 'react';

// Tiny hash router (no dependency): #/scan · #/customers · #/recent · #/customer/CUP-XXXXXXXX. The hash keeps the browser / tablet "back" button working
// and lets a profile be reopened after a reload without any server-side route.
export type Route = { name: 'scan' } | { name: 'customers' } | { name: 'recent' } | { name: 'customer'; code: string };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'customers') return { name: 'customers' };
  if (parts[0] === 'recent') return { name: 'recent' };
  if (parts[0] === 'customer' && parts[1]) {
    try {
      return { name: 'customer', code: decodeURIComponent(parts[1]).slice(0, 64) };
    } catch {
      return { name: 'scan' };
    }
  }
  return { name: 'scan' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export const goScan = () => {
  window.location.hash = '#/scan';
};
export const goCustomers = () => {
  window.location.hash = '#/customers';
};
export const goRecent = () => {
  window.location.hash = '#/recent';
};
export const openCustomer = (code: string) => {
  window.location.hash = `#/customer/${encodeURIComponent(code)}`;
};
