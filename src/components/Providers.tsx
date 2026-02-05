'use client';

import GlobalChatbot from './GlobalChatbot';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <GlobalChatbot />
    </>
  );
}
