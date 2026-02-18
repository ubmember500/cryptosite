import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, Sun, Moon } from 'lucide-react';
import { useMarketStore } from '../../store/marketStore';
import { useLanguageStore } from '../../store/languageStore';
import { useThemeStore } from '../../store/themeStore';
import UserAccountMenu from '../common/UserAccountMenu';
import i18n from '../../i18n';

const Navbar = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const searchCoins = useMarketStore((state) => state.searchCoins);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const navigate = useNavigate();

  const isMarketPage = location.pathname === '/market' || location.pathname.startsWith('/market/');
  const showThemeToggle = !isMarketPage;

  const handleLanguageChange = (lang) => {
    setLanguage(lang);
    i18n.changeLanguage(lang);
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    
    // In a real app, this might show a dropdown. 
    // For now, let's just navigate to the first result or a search page
    try {
        const results = await searchCoins(searchQuery);
        setSearchResults(results);
        if (results.length > 0) {
            // Navigate to the first coin found
            navigate(`/market/${results[0].id}`);
            setSearchQuery('');
            setSearchResults([]);
        }
    } catch (error) {
        console.error("Search failed", error);
    }
  };

  return (
    <header className="bg-gray-800 border-b border-gray-700 shadow-sm z-10">
      <div className="flex items-center justify-between h-16 px-6">
        {/* Mobile menu button could go here */}
        
        {/* Search */}
        <div className="flex-1 flex justify-center lg:justify-start">
          <div className="w-full max-w-lg lg:max-w-xs">
            <label htmlFor="search" className="sr-only">{t('Search')}</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-gray-400" />
              </div>
              <form onSubmit={handleSearch}>
                <input
                  id="search"
                  name="search"
                  className="block w-full pl-10 pr-3 py-2 border border-gray-600 rounded-md leading-5 bg-gray-700 text-gray-300 placeholder-gray-400 focus:outline-none focus:bg-gray-600 focus:border-blue-500 focus:ring-blue-500 sm:text-sm transition-colors"
                  placeholder={t('Search coins...')}
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </form>
            </div>
          </div>
        </div>

        {/* Right side: language switcher, notifications, user */}
        <div className="ml-4 flex items-center md:ml-6 space-x-4">
          <div className="flex items-center rounded-lg border border-gray-600 bg-gray-700/50 p-0.5" role="group" aria-label="Language">
            <button
              type="button"
              onClick={() => handleLanguageChange('en')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-gray-800 focus:ring-blue-500 ${language === 'en' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => handleLanguageChange('ru')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-gray-800 focus:ring-blue-500 ${language === 'ru' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              RUS
            </button>
          </div>

          {showThemeToggle && (
            <button
              type="button"
              onClick={toggleTheme}
              className="p-1.5 rounded-full text-gray-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-blue-500"
              aria-label={theme === 'dark' ? t('Switch to light theme') : t('Switch to dark theme')}
            >
              {theme === 'dark' ? (
                <Sun className="h-5 w-5" />
              ) : (
                <Moon className="h-5 w-5" />
              )}
            </button>
          )}

          <UserAccountMenu chipClassName="border-gray-600 bg-gray-800 px-2.5 py-1.5 hover:bg-gray-700 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800" />
        </div>
      </div>
    </header>
  );
};

export default Navbar;
