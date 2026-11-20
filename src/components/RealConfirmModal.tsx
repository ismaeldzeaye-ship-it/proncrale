import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface RealConfirmModalProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const RealConfirmModal: React.FC<RealConfirmModalProps> = ({
  open,
  onCancel,
  onConfirm,
}) => {
  const [typedText, setTypedText] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  if (!open) return null;

  const canConfirm = typedText.trim() === 'REAL' && acknowledged;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="real-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
    >
      <div className="w-full max-w-md rounded-lg border border-red-300 bg-white p-6 shadow-xl dark:border-red-900/60 dark:bg-[#111827]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 text-red-600 dark:text-red-400">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <h2 id="real-confirm-title" className="text-base font-semibold">
              Confirm Real Account Mode
            </h2>
          </div>
          <button
            type="button"
            onClick={() => {
              setTypedText('');
              setAcknowledged(false);
              onCancel();
            }}
            aria-label="Close Real account confirmation"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Real mode routes multiplier proposals and buy orders to Deriv&apos;s real-money gateway (
          <span className="font-mono text-xs">/ws/real</span>). This confirmation resets on every app reload.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label
              htmlFor="real-confirm-input"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Type <span className="font-mono font-semibold text-red-600 dark:text-red-400">REAL</span> to unlock real execution
            </label>
            <input
              id="real-confirm-input"
              type="text"
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              placeholder="REAL"
              autoComplete="off"
              className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-red-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-500"
            />
            <span>
              I understand live orders place real financial risk subject to my configured hard caps and Guard rules.
            </span>
          </label>
        </div>

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              setTypedText('');
              setAcknowledged(false);
              onCancel();
            }}
            className="min-h-[40px] rounded-md border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Stay in Paper
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => {
              setTypedText('');
              setAcknowledged(false);
              onConfirm();
            }}
            className="min-h-[40px] rounded-md bg-red-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Enable Real Mode
          </button>
        </div>
      </div>
    </div>
  );
};
