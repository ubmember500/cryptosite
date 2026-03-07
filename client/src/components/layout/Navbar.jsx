import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Search, Sun, Moon } from 'lucide-react';
import { useMarketStore } from '../../store/marketStore';
import { useLanguageStore } from '../../store/languageStore';
import { useThemeStore } from '../../store/themeStore';
import { isDarkTheme } from '../../config/themes';
import UserAccountMenu from '../common/UserAccountMenu';
import TopNav from '../common/TopNav';
import i18n from '../../i18n';

const Navbar = () => {
  const { t } = useTranslation();
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const searchCoins = useMarketStore((state) => state.searchCoins);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const navigate = useNavigate();
  const currentIsDark = isDarkTheme(theme);

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
    <header className="bg-surface border-b border-border shadow-sm z-10">
      <div className="flex items-center h-12 md:h-14 px-3 md:px-4 gap-2 md:gap-3">
        {/* Left: search */}
        <div className="shrink-0 w-32 sm:w-40 md:w-44 lg:w-56">
          <label htmlFor="search" className="sr-only">{t('Search')}</label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-textSecondary" />
            </div>
            <form onSubmit={handleSearch}>
              <input
                id="search"
                name="search"
                className="block w-full pl-9 pr-2 py-1.5 border border-border rounded-md leading-5 bg-surfaceHover text-textPrimary placeholder-textSecondary focus:outline-none focus:bg-surface focus:border-accent focus:ring-accent text-xs transition-colors"
                placeholder={t('Search coins...')}
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </form>
          </div>
        </div>

        {/* Center: top navigation */}
        <div className="flex-1 flex justify-center overflow-x-auto scrollbar-none">
          <TopNav />
        </div>

        {/* Right: language switcher, theme toggle, user menu */}
        <div className="shrink-0 flex items-center gap-1.5 md:gap-2">
          <div className="flex items-center rounded-lg border border-border bg-surfaceHover/50 p-0.5" role="group" aria-label="Language">
            <button
              type="button"
              onClick={() => handleLanguageChange('en')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-surface focus:ring-accent ${language === 'en' ? 'bg-accent text-white' : 'text-textSecondary hover:text-textPrimary'}`}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => handleLanguageChange('ru')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-surface focus:ring-accent ${language === 'ru' ? 'bg-accent text-white' : 'text-textSecondary hover:text-textPrimary'}`}
            >
              RUS
            </button>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            className="p-1.5 rounded-full text-textSecondary hover:text-textPrimary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface focus:ring-accent"
            aria-label={currentIsDark ? t('Switch to light theme') : t('Switch to dark theme')}
          >
            {currentIsDark ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>

          <UserAccountMenu chipClassName="border-border bg-surface px-2.5 py-1.5 hover:bg-surfaceHover focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface" />
        </div>
      </div>
    </header>
  );
};

export default Navbar;
