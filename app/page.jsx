'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { getLobsterTypes, getWeightClasses } from '@/lib/cache';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Box, FolderInput, FolderOutput } from 'lucide-react';
import { ChartBulan } from '@/components/chart-bulan';
import { ChartJenis } from '@/components/chart-jenis';
import { AppSidebar } from '@/components/app-sidebar';
import debounce from 'lodash/debounce';

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [totalStock, setTotalStock] = useState(0);
  const [incomingThisMonth, setIncomingThisMonth] = useState(0);
  const [outgoingThisMonth, setOutgoingThisMonth] = useState(0);
  const [stockByType, setStockByType] = useState([]);
  const [weightClasses, setWeightClasses] = useState({});
  const [chartData, setChartData] = useState([]);
  const [pieChartData, setPieChartData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check authentication
  useEffect(() => {
    const fetchSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setUser(session?.user || null);
      setLoading(false);
    };
    fetchSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_, session) => {
        setUser(session?.user || null);
        setLoading(false);
      }
    );

    return () => authListener.subscription?.unsubscribe();
  }, []);

  // Fetch weight classes for a lobster type
  const fetchWeightClasses = useCallback(async (typeId, typeName) => {
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timed out')), 5000)
      );

      const result = await Promise.race([
        (async () => {
          const { data: inventoryData, error } = await supabase
            .from('inventory')
            .select(
              'weight_class_id, quantity, weight_classes!inner(weight_range)'
            )
            .eq('type_id', typeId)
            .gt('quantity', 0);
          if (error) throw error;

          return inventoryData.map((row) => ({
            weight_range: row.weight_classes?.weight_range || 'Unknown',
            quantity: row.quantity || 0,
          }));
        })(),
        timeoutPromise,
      ]);

      setWeightClasses((prev) => ({ ...prev, [typeName]: result }));
    } catch {
      setWeightClasses((prev) => ({ ...prev, [typeName]: [] }));
    }
  }, []);

  // Fetch dashboard data
  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);

      // Fetch cached data
      const [lobsterTypes, weightClassesData] = await Promise.all([
        getLobsterTypes(supabase),
        getWeightClasses(supabase),
      ]);

      // Fetch inventory
      const { data: inventoryData, error: inventoryError } = await supabase
        .from('inventory')
        .select('type_id, quantity');
      if (inventoryError) throw inventoryError;

      // Calculate total stock and group by type
      const total = inventoryData.reduce(
        (sum, row) => sum + (row.quantity || 0),
        0
      );
      const grouped = inventoryData.reduce((acc, row) => {
        const type = lobsterTypes.find((t) => t.id === row.type_id);
        const typeName = type?.name;
        if (typeName)
          acc[typeName] = (acc[typeName] || 0) + (row.quantity || 0);
        return acc;
      }, {});
      const stockByTypeArray = Object.entries(grouped).map(
        ([name, total_quantity]) => ({
          lobster_type: name,
          total_quantity,
        })
      );

      // Fetch weight classes for each type
      await Promise.all(
        stockByTypeArray.map(({ lobster_type }) => {
          const typeId = lobsterTypes.find((t) => t.name === lobster_type)?.id;
          return typeId ? fetchWeightClasses(typeId, lobster_type) : null;
        })
      );

      // Fetch this month's transactions
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const { data: transactionsData, error: transactionsError } =
        await supabase
          .from('transactions')
          .select('quantity, transaction_type, type_id')
          .gte('transaction_date', startOfMonth.toISOString())
          .lte('transaction_date', endOfMonth.toISOString());
      if (transactionsError) throw transactionsError;

      const incoming = transactionsData
        .filter((t) => t.transaction_type === 'ADD')
        .reduce((sum, t) => sum + (t.quantity || 0), 0);
      const outgoing = Math.abs(
        transactionsData
          .filter((t) =>
            ['DISTRIBUTE', 'DEATH', 'DAMAGED'].includes(t.transaction_type)
          )
          .reduce((sum, t) => sum + (t.quantity || 0), 0)
      );

      // Fetch pie chart data
      const { data: pieData, error: pieError } = await supabase
        .from('transactions')
        .select('quantity, transaction_type, type_id')
        .in('transaction_type', ['DISTRIBUTE', 'DEATH', 'DAMAGED']);
      if (pieError) throw pieError;

      const pieGrouped = pieData.reduce((acc, row) => {
        const type = lobsterTypes.find((t) => t.id === row.type_id);
        const typeName = type?.name;
        if (typeName)
          acc[typeName] = (acc[typeName] || 0) + Math.abs(row.quantity || 0);
        return acc;
      }, {});
      const pieChartArray = Object.entries(pieGrouped).map(
        ([lobster_type, quantity]) => ({
          lobster_type,
          quantity,
        })
      );

      // Fetch last 6 months' transactions
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
      sixMonthsAgo.setDate(1);

      const { data: monthlyData, error: monthlyError } = await supabase
        .from('transactions')
        .select('quantity, transaction_type, transaction_date')
        .gte('transaction_date', sixMonthsAgo.toISOString());
      if (monthlyError) throw monthlyError;

      // Process monthly chart data
      const months = Array.from({ length: 6 }, (_, i) => {
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        return {
          month: date.toLocaleString('en-US', { month: 'long' }),
          year: date.getFullYear(),
          monthIndex: date.getMonth(),
        };
      }).reverse();

      const monthlyChartData = months.map(({ month, year, monthIndex }) => {
        const monthTransactions = monthlyData.filter((t) => {
          const date = new Date(t.transaction_date);
          return date.getFullYear() === year && date.getMonth() === monthIndex;
        });

        const incoming = monthTransactions
          .filter((t) => t.transaction_type === 'ADD')
          .reduce((sum, t) => sum + (t.quantity || 0), 0);
        const outgoing = Math.abs(
          monthTransactions
            .filter((t) =>
              ['DISTRIBUTE', 'DEATH', 'DAMAGED'].includes(t.transaction_type)
            )
            .reduce((sum, t) => sum + (t.quantity || 0), 0)
        );

        return { month, Masuk: incoming, Keluar: outgoing };
      });

      setTotalStock(total);
      setStockByType(stockByTypeArray);
      setIncomingThisMonth(incoming);
      setOutgoingThisMonth(outgoing);
      setPieChartData(pieChartArray);
      setChartData(monthlyChartData);
      setError(null);
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }, [fetchWeightClasses]);

  // Debounced fetch for real-time updates
  const debouncedFetchDashboardData = useMemo(
    () => debounce(fetchDashboardData, 500, { leading: false, trailing: true }),
    [fetchDashboardData]
  );

  // Initial fetch and real-time subscriptions
  useEffect(() => {
    if (user) {
      fetchDashboardData();

      const inventorySubscription = supabase
        .channel('inventory')
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'inventory' },
          debouncedFetchDashboardData
        )
        .subscribe();

      const transactionsSubscription = supabase
        .channel('transactions')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'transactions' },
          debouncedFetchDashboardData
        )
        .subscribe();

      return () => {
        supabase.removeChannel(inventorySubscription);
        supabase.removeChannel(transactionsSubscription);
        debouncedFetchDashboardData.cancel();
      };
    }
  }, [user, debouncedFetchDashboardData]);

  // Memoized UI data
  const memoizedChartData = useMemo(() => chartData, [chartData]);
  const memoizedPieChartData = useMemo(() => pieChartData, [pieChartData]);

  // Render loading, unauthorized, or error states
  if (loading) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <p>Loading dashboard...</p>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  if (!user) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <p>Please log in to view the dashboard.</p>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  if (error) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <p className="text-red-500">Error: {error}</p>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <div className="grid auto-rows-min gap-4 md:grid-cols-3">
            <Card
              className="w-full rounded-xl shadow-lg relative overflow-hidden"
              style={{
                background: 'linear-gradient(145deg, #ffffff, #d4f4d4)',
                boxShadow:
                  '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                border: '1px solid rgba(220, 252, 231, 0.7)',
              }}
            >
              <CardHeader>
                <CardTitle>
                  <h1 className="dark:text-black">Total Stok Lobster</h1>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-center gap-12">
                  <p className="text-7xl dark:text-black">{totalStock}</p>
                  <Box size={66} className="dark:stroke-black" />
                </div>
              </CardContent>
              <CardFooter className="pb-2">
                <p className="dark:text-black text-4xl">Ekor</p>
              </CardFooter>
            </Card>
            <Card
              className="w-full rounded-xl shadow-lg relative overflow-hidden"
              style={{
                background: 'linear-gradient(145deg, #ffffff, #d4e4f4)',
                boxShadow:
                  '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                border: '1px solid rgba(220, 231, 252, 0.7)',
              }}
            >
              <CardHeader>
                <CardTitle>
                  <h1 className="dark:text-black">
                    Jumlah Lobster Masuk Bulan ini
                  </h1>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-center gap-12">
                  <p className="text-7xl dark:text-black">
                    {incomingThisMonth}
                  </p>
                  <FolderInput size={66} className="dark:stroke-black" />
                </div>
              </CardContent>
              <CardFooter className="pb-2">
                <p className="dark:text-black text-4xl">Ekor</p>
              </CardFooter>
            </Card>
            <Card
              className="w-full rounded-xl shadow-lg relative overflow-hidden"
              style={{
                background: 'linear-gradient(145deg, #ffffff, #e4d4f4)',
                boxShadow:
                  '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                border: '1px solid rgba(231, 220, 252, 0.7)',
              }}
            >
              <CardHeader>
                <CardTitle>
                  <h1 className="dark:text-black">
                    Jumlah Lobster Dikirim Bulan Ini
                  </h1>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-center gap-12">
                  <p className="text-7xl dark:text-black">
                    {Math.abs(outgoingThisMonth)}
                  </p>
                  <FolderOutput size={66} className="dark:stroke-black" />
                </div>
              </CardContent>
              <CardFooter className="pb-2">
                <p className="dark:text-black text-4xl">Ekor</p>
              </CardFooter>
            </Card>
          </div>

          <div className="mt-8">
            <h2 className="text-2xl font-bold mb-4">Tren Bulanan</h2>
            <ChartBulan chartData={memoizedChartData} />
          </div>
          <div className="mt-8">
            <h2 className="text-2xl font-bold mb-4">
              Distribusi Berdasarkan Jenis Lobster
            </h2>
            <ChartJenis chartData={memoizedPieChartData} />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
