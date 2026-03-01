import React from 'react';
import { cn } from '../../utils/cn';

const Table = ({ columns, data, onRowClick, className }) => {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-xs md:text-sm text-left text-textPrimary">
        <thead className="text-xs uppercase bg-surface border-b border-border sticky top-0 z-10">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className="px-3 md:px-6 py-2.5 md:py-3 font-medium text-textSecondary cursor-pointer hover:text-textPrimary transition-colors whitespace-nowrap"
                onClick={() => col.sortable && console.log(`Sort by ${col.key}`)}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={i}
              className={cn(
                "border-b border-border hover:bg-surfaceHover/50 transition-colors",
                onRowClick && "cursor-pointer"
              )}
              onClick={() => onRowClick && onRowClick(row)}
            >
              {columns.map((col) => (
                <td key={`${i}-${col.key}`} className="px-3 md:px-6 py-3 md:py-4 whitespace-nowrap">
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default Table;
