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

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.user?.name) {
          setUserName(data.user.name);
        }
      })
      .catch(() => {});
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
      <FeedbackWrapper userName={userName}>
        {children}
      </FeedbackWrapper>
      <ToastNotifications />
    </SWRConfig>
  );
}
