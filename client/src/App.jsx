import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { subscribeToAuth } from './store/authSlice.js';
import Layout from './components/Layout';
import RequireAuth from './components/RequireAuth';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import DebtPlanner from './pages/DebtPlanner';
import Transactions from './pages/Transactions';
import Import from './pages/Import';
import Budgets from './pages/Budgets';
import Forecast from './pages/Forecast';

export default function App() {
  const dispatch = useDispatch();
  useEffect(() => {
    const unsub = subscribeToAuth(dispatch);
    return () => unsub();
  }, [dispatch]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Dashboard />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="debts" element={<DebtPlanner />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="import" element={<Import />} />
          <Route path="budgets" element={<Budgets />} />
          <Route path="forecast" element={<Forecast />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
