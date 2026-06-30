'use client';

import { useState, useEffect } from 'react';
import { SWRConfig } from 'swr';
import FeedbackWrapper from './FeedbackWrapper';
import ToastNotifications from './ToastNotifications';

const swrFetcher = (url: string) =>
  fetch(url).then((res) => {
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
        revalidateOnReconnect: true,
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
