'use client';

import React, { useRef, useEffect, useState } from 'react';
import type { ChatMessage, Conversation, ViewSnapshot, AnalyzeResponse, AnalyzeRequest } from '@/lib/types';

interface ChatSidebarProps {
  messages: ChatMessage[];
  conversations: Conversation[];
  currentConvId: string | null;
  busy: boolean;
  statusMessage: string;
  dataset: string;
  configJson: string;
  hasExistingChart: boolean;
  isAnalysisView: boolean;
  onNewChat: () => void;
  onConversationLoad: (id: string) => void;
  onSendMessage: (prompt: string, response: AnalyzeResponse) => void;
  onRestoreSnapshot: (snapshotId: string) => void;
}

export default function ChatSidebar({
  messages, conversations, currentConvId, busy, statusMessage,
  dataset, configJson, hasExistingChart, isAnalysisView,
  onNewChat, onConversationLoad, onSendMessage, onRestoreSnapshot,
}: ChatSidebarProps) {
  const [promptInput, setPromptInput] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedConvId, setSelectedConvId] = useState<string>('');
  const [selectedQuestionIdx, setSelectedQuestionIdx] = useState<string>('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const history = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);

  // Sync history from messages
  useEffect(() => {
    history.current = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.rawContent }));
  }, [messages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const userMessages = messages.filter(m => m.role === 'user');

  const handleSend = async () => {
    const text = promptInput.trim();
    if (!text || busy || sending) return;
    setPromptInput('');
    setSending(true);

    const req: AnalyzeRequest = {
      prompt: text,
      dataset,
      configJson,
      history: history.current.slice(-8),
      hasExistingChart,
      isAnalysisView,
    };

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      const data = await res.json() as AnalyzeResponse;
      onSendMessage(text, data);
    } catch (e) {
      onSendMessage(text, {
        type: 'error',
        htmlContent: `<p class="ai-error">Network error: ${(e as Error).message}</p>`,
        rawContent: `Network error: ${(e as Error).message}`,
        error: (e as Error).message,
      });
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleConvChange = (convId: string) => {
    setSelectedConvId(convId);
    if (convId) onConversationLoad(convId);
  };

  const handleQuestionJump = (idx: string) => {
    setSelectedQuestionIdx('');
    if (!idx) return;
    const n = parseInt(idx, 10);
    const el = document.querySelectorAll('.chat-message')[n];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const isBusy = busy || sending;

  return (
    <div className="chat-sidebar panel ai-panel">
      {/* Header */}
      <div className="ai-header">
        <div className="ai-header-top">
          <h2>AI Analyst</h2>
          <button className="ghost-btn new-chat-btn" onClick={onNewChat}>+ New</button>
        </div>
        <p>Ask questions, request charts, or adjust the grid.</p>
      </div>

      {/* Conversation navigation */}
      <div className="conv-nav">
        {conversations.length > 0 && (
          <select
            className="select-input conv-select"
            value={selectedConvId}
            onChange={e => handleConvChange(e.target.value)}
          >
            <option value="">Select conversation…</option>
            {conversations.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        {userMessages.length > 0 && (
          <select
            className="select-input question-nav"
            value={selectedQuestionIdx}
            onChange={e => handleQuestionJump(e.target.value)}
          >
            <option value="">Jump to question…</option>
            {userMessages.map((m, i) => {
              const label = m.rawContent.length > 60 ? m.rawContent.slice(0, 60) + '…' : m.rawContent;
              return <option key={m.id} value={String(messages.indexOf(m))}>{label}</option>;
            })}
          </select>
        )}
      </div>

      {/* Messages */}
      <div className="analysis-output">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`chat-message chat-message--${msg.role}`}
            id={`msg-${msg.id}`}
          >
            <div className="chat-message-header">
              <span className="chat-title">{msg.title}</span>
            </div>
            <div
              className="chat-message-body"
              dangerouslySetInnerHTML={{ __html: msg.htmlContent }}
            />
            {msg.snapshotId && msg.role === 'assistant' && (
              <div className="restore-from-chat-wrap">
                <button
                  className="ghost-btn restore-from-chat"
                  onClick={() => onRestoreSnapshot(msg.snapshotId!)}
                >
                  ↩ Restore this view
                </button>
              </div>
            )}
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Composer */}
      <div className="ai-composer">
        <textarea
          className="prompt-textarea"
          placeholder={isBusy ? 'Thinking…' : 'Ask a question or request a chart…'}
          value={promptInput}
          onChange={e => setPromptInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isBusy}
        />
        <div className="ai-actions">
          <button
            className="primary-btn send-btn"
            onClick={handleSend}
            disabled={isBusy || !promptInput.trim()}
          >{isBusy ? 'Thinking…' : 'Send'}</button>
        </div>
        <div className="chat-status-bar">{statusMessage}</div>
      </div>
    </div>
  );
}
