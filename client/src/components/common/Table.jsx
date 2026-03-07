import React from 'react';
import { cn } from '../../utils/cn';

const Table = ({ columns, data, onRowClick, className }) => {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-xs md:text-sm text-left text-textPrimary">
        <thead className="text-xs uppercase bg-surfaceDark/40 border-b border-border/50 sticky top-0 z-10 backdrop-blur-sm">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className="px-3 md:px-6 py-2.5 md:py-3 font-semibold text-textSecondary/80 tracking-wider cursor-pointer hover:text-textPrimary transition-colors duration-200 whitespace-nowrap"
                onClick={() => col.sortable && console.log(`Sort by ${col.key}`)}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/30">
          {data.map((row, i) => (
            <tr
              key={i}
              className={cn(
                "hover:bg-surfaceHover/40 transition-colors duration-150",
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
