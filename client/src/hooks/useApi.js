import { useState, useEffect, useCallback } from 'react';
import { useToastStore } from '../store/toastStore';

export const useApi = (apiFunction) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const addToast = useToastStore((state) => state.addToast);

  const execute = useCallback(async (...args) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFunction(...args);
      setData(result);
      return result;
    } catch (err) {
      setError(err);
      addToast(err.message || 'An unexpected error occurred', 'error');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [apiFunction, addToast]);

  return { data, loading, error, execute, setData };
};

export const useApiOnMount = (apiFunction, params = []) => {
  const { data, loading, error, execute } = useApi(apiFunction);

  useEffect(() => {
    execute(...params);
  }, [execute, ...params]);

  return { data, loading, error, refresh: execute };
};
