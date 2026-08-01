'use client';

import { useState, useEffect } from 'react';
import { SWRConfig } from 'swr';
import FeedbackWrapper from './FeedbackWrapper';
import ToastNotifications from './ToastNotifications';

const swrFetcher = (url: string) =>
  // credentials: 'same-origin' is REQUIRED, the middleware gates every /api/*
  // route behind the auth cookie. Without this, SWR fetches omit the cookie,
  // get a 401, and page.tsx interprets that as an invalid session and logs the
  // user out. This was the root cause of the "keeps logging out" bug.
  fetch(url, { credentials: 'same-origin' }).then((res) => {
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  });

export default function Providers({ children }: { children: React.ReactNode }) {
  const [userName, setUserName] = useState('Anonymous');
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (data.user?.name) {
          setUserName(data.user.name);
          setIsAuthenticated(true);
        } else {
          setUserName('Anonymous');
          setIsAuthenticated(false);
        }
      })
      .catch(() => {
        setUserName('Anonymous');
        setIsAuthenticated(false);
      });
  }, []);

  return (
    <SWRConfig
      value={{
        fetcher: swrFetcher,
        dedupingInterval: 60_000,
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        keepPreviousData: true,
      }}
    >
      <FeedbackWrapper userName={userName} enabled={isAuthenticated}>
        {children}
      </FeedbackWrapper>
      <ToastNotifications />
    </SWRConfig>
  );
}
