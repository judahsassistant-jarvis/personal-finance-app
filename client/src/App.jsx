import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { subscribeToAuth } from './store/authSlice.js';
import Layout from './components/Layout';
import RequireAuth from './components/RequireAuth';
import RequireOnboarded from './components/RequireOnboarded';
import Login from './pages/Login';
import FirstRun from './pages/FirstRun';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import DebtPlanner from './pages/DebtPlanner';
import DebtPlannerLayout from './pages/debts/DebtPlannerLayout';
import WhatIf from './pages/debts/WhatIf';
import Bonus from './pages/debts/Bonus';
import Reminders from './pages/debts/Reminders';
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
        <Route path="/welcome" element={<RequireAuth><FirstRun /></RequireAuth>} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <RequireOnboarded>
                <Layout />
              </RequireOnboarded>
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="debts" element={<DebtPlannerLayout />}>
            <Route index element={<DebtPlanner />} />
            <Route path="what-if" element={<WhatIf />} />
            <Route path="bonus" element={<Bonus />} />
            <Route path="reminders" element={<Reminders />} />
          </Route>
          <Route path="transactions" element={<Transactions />} />
          <Route path="import" element={<Import />} />
          <Route path="budgets" element={<Budgets />} />
          <Route path="forecast" element={<Forecast />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
