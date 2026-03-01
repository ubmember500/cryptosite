import React from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Navbar from './Navbar';
import { useSocket } from '../../hooks/useSocket';
import { useAuth } from '../../hooks/useAuth';

const Layout = () => {
  const { t } = useTranslation();
  useSocket();
  const { loading } = useAuth();

  if (loading) {
      return (
        <div className="flex min-h-[100dvh] items-center justify-center bg-background text-textPrimary">
              {t('Loading...')}
          </div>
      );
  }

  // If not authenticated, useAuth handles redirection, but we might want to avoid flashing content
  // However, for the layout, it's safer to just render the shell if we are authenticated or let the router handle it.
  // Given useAuth redirects, we can assume if we are here and not loading, we are either authenticated or about to be redirected.
  
  return (
    <div className="flex min-h-[100dvh] bg-background text-textPrimary">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Navbar />
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-background app-page">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
