import React from 'react';
import { AgentStatus } from '../engine/types';

interface AgentGridProps {
  agents: AgentStatus[];
}

const STATUS_STYLE: Record<
  AgentStatus['status'],
  { label: string; colorClass: string }
> = {
  nominal: {
    label: 'Nominal',
    colorClass: 'text-slate-600 dark:text-slate-300',
  },
  active: {
    label: 'Active',
    colorClass: 'text-emerald-600 dark:text-emerald-400',
  },
  warning: {
    label: 'Standby',
    colorClass: 'text-amber-600 dark:text-amber-400',
  },
  blocked: {
    label: 'Blocked',
    colorClass: 'text-red-600 dark:text-red-400',
  },
};

export const AgentGrid: React.FC<AgentGridProps> = ({ agents }) => {
  return (
    <section aria-label="Six Evaluation Agents">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Six Evaluation Agents
        </h2>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Live per-pair pipeline state
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent) => {
          const st = STATUS_STYLE[agent.status];
          return (
            <div
              key={agent.name}
              data-testid={`agent-card-${agent.name.toLowerCase()}`}
              className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111827]"
            >
              <div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {agent.name}
                    <span className="ml-1.5 font-normal text-slate-500 dark:text-slate-400">
                      · {agent.role}
                    </span>
                  </span>
                  <span className={`font-mono font-medium ${st.colorClass}`}>
                    {st.label}
                  </span>
                </div>

                <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                  {agent.headline}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {agent.detail}
                </p>
              </div>

              <div className="mt-3 border-t border-slate-100 pt-2 font-mono text-[11px] text-slate-400 dark:border-slate-800/80 dark:text-slate-500">
                Updated {agent.updatedAt} NY
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
