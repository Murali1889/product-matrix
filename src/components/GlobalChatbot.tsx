'use client';

/**
 * Global AI Chatbot
 * - Floating button accessible from any page
 * - Persists conversation history in localStorage
 * - Can analyze any client on demand
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  MessageCircle, X, Send, Search, Sparkles, Minimize2, Maximize2
} from 'lucide-react';

interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

const STORAGE_KEY = 'hyperverge_chat_history';
const MAX_MESSAGES = 50; // Keep last 50 messages

export default function GlobalChatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Load history from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setMessages(parsed);
        } catch (e) {
          console.error('Failed to parse chat history:', e);
        }
      }
    }
  }, []);

  // Save history to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined' && messages.length > 0) {
      // Keep only last MAX_MESSAGES
      const toSave = messages.slice(-MAX_MESSAGES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    }
  }, [messages]);

  // Auto-scroll
  useEffect(() => {
    if (isOpen && !isMinimized) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, isMinimized]);

  // AI Chat function
  const sendMessage = useCallback(async (query: string) => {
    if (!query.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: query,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      // Use AI chat API
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: query.trim(),
          history: messages.slice(-6).map(m => ({ type: m.type, content: m.content })),
        }),
      });

      const data = await res.json();

      let response = '';
      if (data.success) {
        response = data.response;
      } else {
        // Fallback to basic lookup
        const fallbackRes = await fetch('/api/company-research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'smart', companyName: query.trim() }),
        });
        const fallbackData = await fallbackRes.json();

        if (fallbackData.success) {
          const result = fallbackData.data;
          const client = result.data?.client;
          const recs = result.data?.recommendations || result.data?.defaultRecommendations || [];

          if (client) {
            response = `**${client.name}** - Revenue: $${client.totalRevenue.toLocaleString()}, APIs: ${client.apiCount}`;
            if (recs.length > 0) {
              response += `\n\nUpsell: ${recs.slice(0, 3).map((r: { api: string }) => r.api).join(', ')}`;
            }
          } else {
            response = `**${query}** is a new prospect. Recommended: ${recs.slice(0, 3).map((r: { api: string }) => r.api).join(', ')}`;
          }
        } else {
          response = data.error || 'Sorry, I encountered an error. Please try again.';
        }
      }

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: response,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: 'Connection error. Please try again.',
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputValue);
  };

  const clearHistory = () => {
    setMessages([]);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  // Keyboard shortcut: Cmd/Ctrl + K to open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
        setIsMinimized(false);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  return (
    <>
      {/* Floating Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full shadow-lg flex items-center justify-center cursor-pointer transition-all hover:scale-105 z-50"
          title="AI Assistant (⌘K)"
        >
          <MessageCircle className="w-6 h-6" />
          {messages.length > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-amber-500 rounded-full text-xs flex items-center justify-center font-medium">
              {messages.filter(m => m.type === 'user').length}
            </span>
          )}
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div
          className={`fixed bottom-6 right-6 bg-white rounded-2xl shadow-2xl border border-stone-200 z-50 flex flex-col transition-all ${
            isMinimized ? 'w-72 h-14' : 'w-96 h-[32rem]'
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 bg-stone-50 rounded-t-2xl">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-emerald-600" />
              <span className="font-medium text-slate-700 text-sm">AI Assistant</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsMinimized(!isMinimized)}
                className="p-1.5 hover:bg-stone-200 rounded-lg cursor-pointer transition-colors"
                title={isMinimized ? 'Expand' : 'Minimize'}
              >
                {isMinimized ? (
                  <Maximize2 className="w-4 h-4 text-slate-500" />
                ) : (
                  <Minimize2 className="w-4 h-4 text-slate-500" />
                )}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 hover:bg-stone-200 rounded-lg cursor-pointer transition-colors"
                title="Close"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
          </div>

          {!isMinimized && (
            <>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <Search className="w-6 h-6 text-emerald-600" />
                    </div>
                    <p className="text-sm text-slate-500 mb-1">Search any company</p>
                    <p className="text-xs text-slate-400">Get instant insights & recommendations</p>
                  </div>
                ) : (
                  <>
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                            msg.type === 'user'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-stone-100 text-slate-700'
                          }`}
                        >
                          {msg.content.split('\n').map((line, i) => {
                            const boldLine = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
                            return (
                              <p
                                key={i}
                                className={i > 0 ? 'mt-1' : ''}
                                dangerouslySetInnerHTML={{ __html: boldLine }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ))}

                    {isLoading && (
                      <div className="flex justify-start">
                        <div className="bg-stone-100 rounded-xl px-3 py-2">
                          <div className="flex items-center gap-1">
                            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" />
                            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.1s]" />
                            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </>
                )}
              </div>

              {/* Clear History */}
              {messages.length > 0 && (
                <div className="px-4 pb-2">
                  <button
                    onClick={clearHistory}
                    className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    Clear history
                  </button>
                </div>
              )}

              {/* Input */}
              <form onSubmit={handleSubmit} className="p-3 border-t border-stone-100">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="Search company..."
                    className="flex-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={!inputValue.trim() || isLoading}
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:cursor-not-allowed text-white rounded-lg transition-colors cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      )}
    </>
  );
}
