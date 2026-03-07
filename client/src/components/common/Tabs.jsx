import React from 'react';
import { cn } from '../../utils/cn';

const Tabs = ({ tabs, activeTab, onChange, className }) => {
  return (
    <div className={cn("flex space-x-0.5 bg-surfaceDark/50 p-1 rounded-xl border border-border/30", className)}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              "flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200",
              isActive
                ? "bg-surface text-textPrimary shadow-md"
                : "text-textSecondary hover:text-textPrimary hover:bg-surface/40"
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};

export default Tabs;
