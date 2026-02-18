import React from 'react';
import { cn } from '../../utils/cn';

const Tabs = ({ tabs, activeTab, onChange, className }) => {
  return (
    <div className={cn("flex space-x-1 bg-surface p-1 rounded-lg", className)}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              "flex-1 px-4 py-2 text-sm font-medium rounded-md transition-all duration-200",
              isActive
                ? "bg-surfaceHover text-white shadow-sm"
                : "text-textSecondary hover:text-textPrimary hover:bg-surfaceHover/50"
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
